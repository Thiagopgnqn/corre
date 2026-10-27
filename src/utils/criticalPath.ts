import type { CriticalPathResult, Subject, UserCareerState } from '../types/career';
import { CORE_SUBJECTS } from '../data/plan2023';
import { isApprovedOrHigher } from './correlativas';

/**
 * Computes the Critical Path (longest remaining prerequisite chain to graduation)
 */
export function calculateCriticalPath(userState: UserCareerState): CriticalPathResult {
  // Filter core subjects that are not yet approved
  const remainingSubjects = CORE_SUBJECTS.filter((s) => !isApprovedOrHigher(userState[s.id]));

  if (remainingSubjects.length === 0) {
    return {
      chain: [],
      length: 0,
      estimatedTerms: 0,
    };
  }

  // Build adjacency list: node -> array of subjects it unlocks (directed edge from prereq to dependent)
  const adj = new Map<number, number[]>();
  CORE_SUBJECTS.forEach((s) => {
    adj.set(s.id, []);
  });

  CORE_SUBJECTS.forEach((s) => {
    const allPrereqs = [...new Set([...s.regularPrereqs, ...s.approvedPrereqs])];
    allPrereqs.forEach((pId) => {
      const neighbors = adj.get(pId) || [];
      neighbors.push(s.id);
      adj.set(pId, neighbors);
    });
  });

  // Helper map for quick subject lookup
  const subjectMap = new Map<number, Subject>();
  CORE_SUBJECTS.forEach((s) => subjectMap.set(s.id, s));

  // Weight function: Annual subjects count as 2 terms; Cuatrimestrales as 1 term
  const getSubjectWeight = (subj: Subject): number => {
    return subj.modality === 'A' ? 2 : 1;
  };

  // Memoized longest path starting from a given node
  const memo = new Map<number, { dist: number; path: number[] }>();

  function dfs(currId: number): { dist: number; path: number[] } {
    if (memo.has(currId)) {
      return memo.get(currId)!;
    }

    const currentSubj = subjectMap.get(currId);
    if (!currentSubj) {
      return { dist: 0, path: [] };
    }

    const currentWeight = getSubjectWeight(currentSubj);
    let maxSubDist = 0;
    let maxSubPath: number[] = [];

    const neighbors = adj.get(currId) || [];
    for (const nextId of neighbors) {
      // Only trace through remaining unapproved subjects
      if (!isApprovedOrHigher(userState[nextId])) {
        const res = dfs(nextId);
        if (res.dist > maxSubDist) {
          maxSubDist = res.dist;
          maxSubPath = res.path;
        }
      }
    }

    const result = {
      dist: currentWeight + maxSubDist,
      path: [currId, ...maxSubPath],
    };

    memo.set(currId, result);
    return result;
  }

  // Find longest path among all remaining unapproved subjects
  let globalMaxDist = 0;
  let globalMaxPath: number[] = [];

  for (const s of remainingSubjects) {
    const res = dfs(s.id);
    if (res.dist > globalMaxDist) {
      globalMaxDist = res.dist;
      globalMaxPath = res.path;
    }
  }

  const chain = globalMaxPath.map((id) => subjectMap.get(id)!).filter(Boolean);

  // Approximate terms calculation: based on sequential dependencies
  // An annual subject takes 1 full year (2 terms), cuatrimestral takes 1 term
  const estimatedTerms = Math.max(1, Math.ceil(globalMaxDist / 1.5));

  return {
    chain,
    length: chain.length,
    estimatedTerms,
  };
}
