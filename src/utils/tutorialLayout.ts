/**
 * Motor de cálculo de layout para el tutorial interactivo (TutorialSpotlight).
 *
 * Función pura y determinista para calcular la posición de la tarjeta del tutorial,
 * el lado óptimo (arriba, abajo, centrado), la prevención de superposición con el objetivo,
 * y la adaptación de textos según capacidades del dispositivo (mouse vs táctil).
 */

export interface RectLike {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom?: number;
  right?: number;
}

export interface ViewportLike {
  width: number;
  height: number;
  offsetTop?: number;
  offsetLeft?: number;
}

export interface SafeInsetsLike {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

export interface TutorialLayoutResult {
  placement: 'top' | 'bottom' | 'center';
  cardCoords: { top: number; left: number };
  cardMaxHeight: number;
  cardMaxWidth?: number;
  shouldCollapseText: boolean;
  overlapDetected: boolean;
  clearancePx: number;
}

export const MIN_AIR_GAP_PX = 12;
export const MIN_TARGET_VISIBILITY_RATIO = 0.9;
export const DEFAULT_SAFE_INSETS: Required<SafeInsetsLike> = {
  top: 12,
  bottom: 12,
  left: 12,
  right: 12,
};

/**
 * Calcula qué proporción (0..1) del área del elemento objetivo se encuentra
 * efectivamente dentro del visualViewport.
 */
export function getTargetVisibilityRatio(
  targetRect: RectLike | null,
  viewport: ViewportLike
): number {
  if (!targetRect || targetRect.width <= 0 || targetRect.height <= 0) {
    return 0;
  }
  const vpTop = viewport.offsetTop ?? 0;
  const vpLeft = viewport.offsetLeft ?? 0;
  const vpRight = vpLeft + viewport.width;
  const vpBottom = vpTop + viewport.height;

  const targetBottom = targetRect.bottom ?? targetRect.top + targetRect.height;
  const targetRight = targetRect.right ?? targetRect.left + targetRect.width;

  const visibleWidth = Math.max(0, Math.min(targetRight, vpRight) - Math.max(targetRect.left, vpLeft));
  const visibleHeight = Math.max(0, Math.min(targetBottom, vpBottom) - Math.max(targetRect.top, vpTop));

  const totalArea = targetRect.width * targetRect.height;
  return totalArea > 0 ? (visibleWidth * visibleHeight) / totalArea : 0;
}

/**
 * Comprueba si el objetivo es al menos un 90% visible dentro del visualViewport.
 */
export function isTargetVisiblyInViewport(
  targetRect: RectLike | null,
  viewport: ViewportLike,
  minRatio: number = MIN_TARGET_VISIBILITY_RATIO
): boolean {
  return getTargetVisibilityRatio(targetRect, viewport) >= minRatio;
}

/**
 * Calcula la colocación óptima de la tarjeta del tutorial garantizando que
 * NUNCA se superponga con el elemento objetivo y seleccionando el lado con mayor
 * espacio libre disponible.
 */
export function computeTutorialLayout(
  targetRect: RectLike | null,
  cardSize: { width: number; height: number },
  viewport: ViewportLike,
  safeInsets: SafeInsetsLike = {}
): TutorialLayoutResult {
  const insets: Required<SafeInsetsLike> = {
    top: safeInsets.top ?? DEFAULT_SAFE_INSETS.top,
    bottom: safeInsets.bottom ?? DEFAULT_SAFE_INSETS.bottom,
    left: safeInsets.left ?? DEFAULT_SAFE_INSETS.left,
    right: safeInsets.right ?? DEFAULT_SAFE_INSETS.right,
  };

  const vpOffsetTop = viewport.offsetTop ?? 0;
  const vpOffsetLeft = viewport.offsetLeft ?? 0;
  const vpWidth = viewport.width;
  const vpHeight = viewport.height;

  // Ancho efectivo de la tarjeta ajustado al ancho disponible
  const effectiveCardWidth = Math.min(cardSize.width, vpWidth - insets.left - insets.right);

  // 1. Caso sin objetivo o colocado al centro
  if (!targetRect || targetRect.width <= 0 || targetRect.height <= 0) {
    const centeredTop = Math.max(
      vpOffsetTop + insets.top,
      Math.round(vpOffsetTop + (vpHeight - cardSize.height) / 2)
    );
    const centeredLeft = Math.max(
      vpOffsetLeft + insets.left,
      Math.round(vpOffsetLeft + (vpWidth - effectiveCardWidth) / 2)
    );

    return {
      placement: 'center',
      cardCoords: { top: centeredTop, left: centeredLeft },
      cardMaxHeight: Math.max(180, vpHeight - insets.top - insets.bottom),
      shouldCollapseText: false,
      overlapDetected: false,
      clearancePx: Math.round(vpHeight / 2),
    };
  }

  const targetBottom = targetRect.bottom ?? (targetRect.top + targetRect.height);
  const targetTop = targetRect.top;
  const targetLeft = targetRect.left;
  const targetRight = targetRect.right ?? (targetRect.left + targetRect.width);

  // Espacio libre real arriba, abajo, izquierda y derecha del objetivo
  const availableAbove = Math.max(0, targetTop - (vpOffsetTop + insets.top) - MIN_AIR_GAP_PX);
  const availableBelow = Math.max(0, (vpOffsetTop + vpHeight - insets.bottom) - targetBottom - MIN_AIR_GAP_PX);
  const availableLeft = Math.max(0, targetLeft - (vpOffsetLeft + insets.left) - MIN_AIR_GAP_PX);
  const availableRight = Math.max(0, (vpOffsetLeft + vpWidth - insets.right) - targetRight - MIN_AIR_GAP_PX);

  // Si tanto arriba como abajo tienen poco espacio vertical (< 170px, ej. 640x360 horizontal)
  // pero a un costado del objetivo hay buen espacio horizontal (>= 220px), ubicar la tarjeta del lado libre lateral
  const maxVerticalSpace = Math.max(availableAbove, availableBelow);
  const maxHorizontalSpace = Math.max(availableLeft, availableRight);
  if (maxVerticalSpace < 170 && maxHorizontalSpace >= 220) {
    const placeRight = availableRight >= availableLeft;
    const sideAvailableW = placeRight ? availableRight : availableLeft;
    const sideCardWidth = Math.min(effectiveCardWidth, sideAvailableW);
    const sideMaxHeight = Math.max(120, vpHeight - insets.top - insets.bottom);
    const sideEffectiveHeight = Math.min(cardSize.height, sideMaxHeight);

    const sideLeft = placeRight
      ? Math.round(targetRight + MIN_AIR_GAP_PX)
      : Math.round(targetLeft - MIN_AIR_GAP_PX - sideCardWidth);
    const sideTop = Math.max(
      vpOffsetTop + insets.top,
      Math.min(
        vpOffsetTop + vpHeight - insets.bottom - sideEffectiveHeight,
        Math.round(vpOffsetTop + (vpHeight - sideEffectiveHeight) / 2)
      )
    );

    return {
      placement: 'bottom',
      cardCoords: { top: sideTop, left: sideLeft },
      cardMaxHeight: Math.floor(sideMaxHeight),
      cardMaxWidth: Math.floor(sideCardWidth),
      shouldCollapseText: sideMaxHeight < cardSize.height || vpHeight < 700,
      overlapDetected: false,
      clearancePx: MIN_AIR_GAP_PX,
    };
  }

  // Regla especial: si el objetivo está anclado a la barra inferior (< 80px del borde inferior),
  // la tarjeta SIEMPRE va arriba para no tapar la navegación.
  const isNearBottomBar = targetBottom >= (vpOffsetTop + vpHeight - 80);

  let placement: 'top' | 'bottom';
  let availableSpaceOnSide: number;

  if (isNearBottomBar) {
    placement = 'top';
    availableSpaceOnSide = availableAbove;
  } else if (availableBelow >= cardSize.height) {
    // Si cabe holgado abajo, preferimos abajo salvo que arriba haya sustancialmente más espacio
    placement = availableAbove > availableBelow * 1.5 ? 'top' : 'bottom';
    availableSpaceOnSide = placement === 'top' ? availableAbove : availableBelow;
  } else if (availableAbove >= cardSize.height) {
    placement = 'top';
    availableSpaceOnSide = availableAbove;
  } else {
    // Ningún lado tiene espacio completo para la tarjeta sin compactar: elegir el lado con más espacio
    placement = availableBelow >= availableAbove ? 'bottom' : 'top';
    availableSpaceOnSide = Math.max(availableAbove, availableBelow);
  }

  // Detectar si requiere colapso de texto o scroll interno (pantallas chicas < 700px o espacio ajustado)
  const shouldCollapseText = availableSpaceOnSide < cardSize.height || vpHeight < 700;
  let effectiveCardHeight = Math.min(cardSize.height, Math.max(48, availableSpaceOnSide));

  let top = 0;
  if (placement === 'bottom') {
    top = targetBottom + MIN_AIR_GAP_PX;
    if (top + effectiveCardHeight > vpOffsetTop + vpHeight - insets.bottom) {
      const maxH = vpOffsetTop + vpHeight - insets.bottom - top;
      if (maxH < effectiveCardHeight) {
        effectiveCardHeight = Math.max(48, maxH);
      }
    }
  } else {
    // placement === 'top'
    const maxBottom = Math.min(targetTop - MIN_AIR_GAP_PX, vpOffsetTop + vpHeight - insets.bottom);
    top = maxBottom - effectiveCardHeight;
    // Si la tarjeta compactada desborda el tope de la pantalla, fijarla contra el borde seguro superior
    if (top < vpOffsetTop + insets.top) {
      top = vpOffsetTop + insets.top;
    }
    // Garantizar que la base de la tarjeta nunca supere maxBottom
    if (top + effectiveCardHeight > maxBottom) {
      effectiveCardHeight = Math.max(48, maxBottom - top);
    }
  }

  // Posición horizontal (centrada con respecto al objetivo en desktop, centrada en pantalla en mobile)
  const isMobile = vpWidth < 640;
  let left = 0;
  if (isMobile) {
    left = Math.max(
      vpOffsetLeft + insets.left,
      Math.round(vpOffsetLeft + (vpWidth - effectiveCardWidth) / 2)
    );
  } else {
    const targetCenterX = targetRect.left + targetRect.width / 2;
    left = Math.round(targetCenterX - effectiveCardWidth / 2);
    // Limitar dentro del viewport horizontal
    left = Math.max(
      vpOffsetLeft + insets.left,
      Math.min(vpOffsetLeft + vpWidth - insets.right - effectiveCardWidth, left)
    );
  }

  // Comprobar estrictamente si existe intersección
  const cardBottom = top + effectiveCardHeight;
  const cardRight = left + effectiveCardWidth;

  const horizontalIntersect = Math.max(0, Math.min(cardRight, targetRight) - Math.max(left, targetRect.left)) > 0;
  const verticalIntersect = Math.max(0, Math.min(cardBottom, targetBottom) - Math.max(top, targetTop)) > 0;
  const overlapDetected = horizontalIntersect && verticalIntersect;

  return {
    placement,
    cardCoords: { top: Math.round(top), left: Math.round(left) },
    cardMaxHeight: Math.max(48, Math.floor(availableSpaceOnSide)),
    shouldCollapseText,
    overlapDetected,
    clearancePx: Math.round(availableSpaceOnSide),
  };
}

/**
 * Adapta dinámicamente los textos del tutorial según las capacidades del dispositivo.
 * En dispositivos móviles táctiles (hover: none) reemplaza atajos de teclado físico
 * (Ctrl + K), menciones a la rueda del mouse o clics, por sus equivalentes táctiles.
 */
export function adaptTutorialText(
  step: { id: string; title: string; description: string; interactiveHint?: string },
  isMobile: boolean
): { title: string; description: string; interactiveHint?: string } {
  let title = step.title;
  let description = step.description;
  let interactiveHint = step.interactiveHint;

  if (isMobile) {
    // 1. Paso 1 (welcome): omitir mención al armador de horarios en mobile
    if (step.id === 'welcome') {
      description = description.replace(
        /, armá tus horarios y consultá las reseñas/gi,
        ' y consultá las reseñas'
      );
    }

    // 2. Paso 2 (graph-overview): "rueda del mouse" -> "deslizar la pantalla y hacer zoom con dos dedos"
    description = description.replace(
      /arrastrar el lienzo y hacer zoom con la rueda del mouse/gi,
      'deslizar la pantalla y hacer zoom con dos dedos'
    );

    // 3. Paso 4 (interactive-click): "Hacé click en" -> "Tocá"
    description = description.replace(/Hacé click en/gi, 'Tocá').replace(/Hacé click/gi, 'Tocá');
    if (interactiveHint) {
      interactiveHint = interactiveHint.replace(/Hacé click en/gi, 'Tocá').replace(/Hacé click/gi, 'Tocá');
    }

    // 4. Paso 9 (analista-switch): aclarar que en mobile se abre el menú Más
    if (step.id === 'analista-switch') {
      description = description.replace(
        /activá este interruptor\./gi,
        'activá este interruptor desde el menú Más.'
      );
    }

    // 5. Paso 10 (app-views): "Ctrl + K" -> "la lupa de la barra superior"
    description = description.replace(
      /al instante con Ctrl \+ K/gi,
      'al instante con la lupa de la barra superior o explorá más opciones en el botón Más'
    );

    // 6. Paso de Reseñas de Profesores: en celular no hay Armador de Horarios, se accede por la pestaña Profesores
    if (step.id === 'professors-reviews-tour') {
      title = 'Reseñas de Profesores';
      description =
        'Consultá puntuaciones y opiniones 100% anónimas por docente y materia directamente desde la pestaña Profesores, y puntuá a tus docentes en materias regularizadas o aprobadas.';
    }

    // 7. Paso de Mi Cursada & Recomendaciones: no mencionar "o al pasar tu horario a cursando"
    if (step.id === 'enrollments-and-recommendations-tour') {
      description = description.replace(
        / o al pasar tu horario a cursando/gi,
        ''
      );
    }
  }

  return {
    title,
    description,
    interactiveHint,
  };
}
