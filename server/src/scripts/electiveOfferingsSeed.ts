/**
 * Ofertas de materias electivas y Seminario Integrador con docentes identificados
 * en las planillas oficiales de 3er, 4to y 5to año (sin franja horaria explícita en grilla).
 */
export const ELECTIVE_OFFERINGS_SEED: Array<{
  courseCode: string;
  subjectCode: number;
  professors: string[];
}> = [
  { courseCode: '3K1', subjectCode: 301, professors: ['Romero, Rubén Aníbal', 'Romani, German Ariel'] },
  { courseCode: '3K1', subjectCode: 99, professors: ['Herrera, Daniel Rodolfo', 'Ortiz, Maria Cecilia'] },
  { courseCode: '3K2', subjectCode: 301, professors: ['Steffolani, Felipe Adrian', 'Romani, German Ariel'] },
  { courseCode: '3K2', subjectCode: 99, professors: ['Arenas, Maria Silvina', 'Mac William, Maria Irene'] },
  { courseCode: '3K3', subjectCode: 301, professors: ['Serrano, Diego Javier', 'Romani, German Ariel'] },
  { courseCode: '3K4', subjectCode: 301, professors: ['Bett, Gustavo Federico', 'Scarafia Altamira, Diego'] },
  { courseCode: '3K4', subjectCode: 99, professors: ['Arenas, Maria Silvina', 'Aquino, Francisco Alejandro'] },
  { courseCode: '4K1', subjectCode: 401, professors: ['Cuevas, Juan Carlos', 'Mana, Franco'] },
  { courseCode: '4K1', subjectCode: 402, professors: ['Villarreal, Gustavo Javier', 'Flores, Nora Viviana'] },
  { courseCode: '4K1', subjectCode: 403, professors: ['Bratti, Alicia Gabriela', 'Chichalof Roberts, Mabel Beatriz'] },
  { courseCode: '4K2', subjectCode: 401, professors: ['Cuevas, Juan Carlos', 'Moya, Vanesa Veronica'] },
  { courseCode: '4K2', subjectCode: 402, professors: ['Villarreal, Gustavo Javier', 'Flores, Nora Viviana'] },
  { courseCode: '4K2', subjectCode: 403, professors: ['Bratti, Alicia Gabriela', 'Chichalof Roberts, Mabel Beatriz'] },
  { courseCode: '4K3', subjectCode: 402, professors: ['Zigaran, Jose Carlos', 'Peralta, Lorena Daniela'] },
  { courseCode: '4K3', subjectCode: 403, professors: ['Bravo, Estela Maris', 'Chichalof Roberts, Mabel Beatriz'] },
  { courseCode: '4K4', subjectCode: 401, professors: ['Mana, Franco', 'Gimenez Zens, Ines Luz'] },
  { courseCode: '4K4', subjectCode: 403, professors: ['Bratti, Alicia Gabriela', 'Velez, German Eduardo'] },
  { courseCode: '4K4', subjectCode: 404, professors: ['Zea Cárdenas, Ninfa Milagros', 'Pardo, Alfredo Luis'] },
  { courseCode: '4K4', subjectCode: 406, professors: ['Odetti, Maria Alejandra', 'Kabusch, Andrés Ricardo'] },
  { courseCode: '5K1', subjectCode: 504, professors: ['Gigena, Elias Fernando', 'Balut Cabezas, Jorge Ariel'] },
  { courseCode: '5K1', subjectCode: 505, professors: ['Gigena, Elias Fernando', 'Balut Cabezas, Jorge Ariel'] },
  { courseCode: '5K1', subjectCode: 507, professors: ['Carignano, Claudia Etna', 'Rustan, Silvina'] },
  { courseCode: '5K1', subjectCode: 512, professors: ['Cuevas, Juan Carlos', 'Castro, Claudia Susana'] },
  { courseCode: '5K2', subjectCode: 502, professors: ['Mana, Franco', 'Gimenez Zens, Ines Luz'] },
  { courseCode: '5K2', subjectCode: 504, professors: ['Martinez, Daniel Ignacio', 'Gigena, Elias Fernando'] },
  { courseCode: '5K2', subjectCode: 505, professors: ['Martinez, Daniel Ignacio', 'Balut Cabezas, Jorge Ariel'] },
  { courseCode: '5K2', subjectCode: 507, professors: ['Peretto, Claudia Beatriz', 'Rosa, Sergio Hernan'] },
  { courseCode: '5K2', subjectCode: 512, professors: ['Cuevas, Juan Carlos', 'Gimenez Zens, Ines Luz'] },
  { courseCode: '5K3', subjectCode: 501, professors: ['Medina, Oscar Carlos', 'Romero, Rubén Aníbal'] },
  { courseCode: '5K3', subjectCode: 504, professors: ['Srur, Leandro Paolo', 'Martinez, Daniel Ignacio'] },
  { courseCode: '5K3', subjectCode: 506, professors: ['Barra, Mario Augusto', 'Galvan, Diego Roman'] },
  { courseCode: '5K3', subjectCode: 507, professors: ['Rustan, Silvina', 'Gualpa, Mariano Martín'] },
  { courseCode: '5K3', subjectCode: 508, professors: ['Montoya, Fanny Esther', 'Bravo, Estela Maris'] },
  { courseCode: '5K3', subjectCode: 514, professors: ['Liberatori, Marcelo Sadi', 'Damiano, Luis Esteban'] },
  { courseCode: '5K4', subjectCode: 505, professors: ['Srur, Leandro Paolo', 'Ruffinatti, Adrian Feliciano'] },
  { courseCode: '5K4', subjectCode: 506, professors: ['Sacco, Pablo Alberto', 'Callejas, Marisa Del Carmen'] },
  { courseCode: '5K4', subjectCode: 509, professors: ['Parisi, Germán Nicolás', 'Bertola, Federico Javier'] },
  { courseCode: '5K4', subjectCode: 510, professors: ['Romero, María Soledad', 'Romero, Rubén Aníbal'] },
];

