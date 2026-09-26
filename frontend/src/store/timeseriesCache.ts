import type { TagPoint } from "@/types";
const values = new Map<string, { points: TagPoint[]; at: number }>();
export const timeseriesCache = {
  get(key: string) {
    const item = values.get(key);
    if (!item || Date.now() - item.at > 600000) {
      values.delete(key);
      return undefined;
    }
    values.delete(key);
    values.set(key,item);
    return item.points;
  },
  put(key: string, points: TagPoint[]) {
    values.delete(key);
    if (values.size >= 40) {
      const first = values.keys().next().value;
      if (first) values.delete(first);
    }
    values.set(key, { points, at: Date.now() });
  },
  invalidateTag(tagCode: string) {
    for (const key of values.keys())
      if (key.startsWith(`${tagCode}|`)) values.delete(key);
  },
};
