import type { Todo } from '../../ports';
import { formatLocalDate } from '../../shared/utils';

/** 没有完成日期就不能证明历史日期已完成。 */
export const completedByDate = (todo: Todo, date: string): boolean => todo.status === 'completed'
  && Boolean(todo.completedAt && formatLocalDate(new Date(todo.completedAt)) <= date);
