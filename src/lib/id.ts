import { randomUUID } from 'expo-crypto';

/** RFC 4122 v4 ids — safe to use as primary keys when the data syncs to a server later. */
export function newId(): string {
  return randomUUID();
}
