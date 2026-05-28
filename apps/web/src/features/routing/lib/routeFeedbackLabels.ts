import {
  ROUTING_FEEDBACK_PROBLEM_TYPES,
  type RoutingFeedbackProblemType,
} from '@/features/routing/types';

export const ROUTING_FEEDBACK_PROBLEM_OPTIONS: readonly {
  readonly value: RoutingFeedbackProblemType;
  readonly label: string;
}[] = [
  { value: 'wrong_route', label: 'Wrong route' },
  { value: 'missing_road', label: 'Missing road' },
  { value: 'road_closed', label: 'Road closed or blocked' },
  { value: 'bad_oneway', label: 'Wrong one-way direction' },
  { value: 'bad_motorbike_route', label: 'Bad motorbike route' },
  { value: 'bad_walk_route', label: 'Bad walking route' },
  { value: 'dangerous_route', label: 'Dangerous route' },
  { value: 'bad_eta', label: 'Time estimate seems wrong' },
  { value: 'cannot_route', label: 'Cannot get a route' },
  { value: 'other', label: 'Other issue' },
];

export function defaultFeedbackProblemType(
  phase: 'idle' | 'loading' | 'success' | 'no_route' | 'error',
): RoutingFeedbackProblemType {
  if (phase === 'no_route') return 'cannot_route';
  if (phase === 'success') return 'wrong_route';
  return 'other';
}

export function isRoutingFeedbackProblemType(
  value: string,
): value is RoutingFeedbackProblemType {
  return (ROUTING_FEEDBACK_PROBLEM_TYPES as readonly string[]).includes(value);
}
