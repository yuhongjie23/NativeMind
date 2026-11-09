export type RecallRating = 'new' | 'difficult' | 'forgotten' | 'familiar' | 'confident';
export interface KnowledgeObservation {
  at: string;
  rating: RecallRating;
  difficulty: string;
  result: string;
}
export interface LearningKnowledge {
  id: string;
  title: string;
  noteId?: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  observations: KnowledgeObservation[];
}
