import { ROUTING_ROUTE_NAME_PATTERN } from '../../../../../../shared/routing.js';

export function isValidRouteName(name: string): boolean {
  return name.length <= 256 && ROUTING_ROUTE_NAME_PATTERN.test(name);
}

export function addRouteTarget(targets: string[], target: string): string[] {
  if (!target || targets.includes(target)) return [...targets];
  return [...targets, target];
}

export function removeRouteTarget(targets: string[], index: number): string[] {
  if (index < 0 || index >= targets.length) return [...targets];
  return targets.filter((_, targetIndex) => targetIndex !== index);
}

export function moveRouteTarget(
  targets: string[],
  index: number,
  direction: -1 | 1,
): string[] {
  const destination = index + direction;
  if (index < 0 || index >= targets.length || destination < 0 || destination >= targets.length) {
    return [...targets];
  }

  const next = [...targets];
  [next[index], next[destination]] = [next[destination], next[index]];
  return next;
}

export function serializeRouteTargets(targets: string[]): string[] {
  return [...new Set(targets.filter(Boolean))];
}
