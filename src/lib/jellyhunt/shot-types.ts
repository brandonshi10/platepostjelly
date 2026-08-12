/**
 * The five kinds of thing a JellyHunt mission asks someone to film.
 *
 * The type drives three things that have to agree: what the filmer is told,
 * how long the clip must be, and what a reviewer checks. Keeping them in one
 * record is why a pastry case and a boba-cooking station stop getting
 * identical instructions.
 *
 * `convex/jellyhunt/admin.ts` holds a second copy of the instruction text and
 * the durations, because Convex modules cannot import from `src/`. The two are
 * pinned together by a test in `tests/jellyhunt-shot-types.test.ts` — change
 * one and that test fails until you change the other.
 */
export const SHOT_TYPES = ["dish", "spread", "action", "display", "ritual"] as const;

export type ShotType = (typeof SHOT_TYPES)[number];

export type ShotTypeSpec = {
  id: ShotType;
  label: string;
  instruction: string;
  minDurationSeconds: number;
  maxDurationSeconds: number;
};

export const SHOT_TYPE_SPECS: Record<ShotType, ShotTypeSpec> = {
  dish: {
    id: "dish",
    label: "Dish",
    instruction:
      "One plated item. Hold the phone steady and make a single close pass over it.",
    minDurationSeconds: 8,
    maxDurationSeconds: 15,
  },
  spread: {
    id: "spread",
    label: "Spread",
    instruction:
      "The whole table. Show the scale first, then pan slowly across everything on it.",
    minDurationSeconds: 10,
    maxDurationSeconds: 20,
  },
  action: {
    id: "action",
    label: "Action",
    instruction:
      "Something being made. Start filming before it starts and don't cut away early.",
    minDurationSeconds: 10,
    maxDurationSeconds: 20,
  },
  display: {
    id: "display",
    label: "Display",
    instruction:
      "The case or counter. One slow pass, keeping the whole display in frame.",
    minDurationSeconds: 8,
    maxDurationSeconds: 15,
  },
  ritual: {
    id: "ritual",
    label: "Ritual",
    instruction:
      "The moment people come here for. One take, and film the person doing it.",
    minDurationSeconds: 8,
    maxDurationSeconds: 15,
  },
};

export function shotTypeSpec(id: string): ShotTypeSpec | undefined {
  return (SHOT_TYPE_SPECS as Record<string, ShotTypeSpec>)[id];
}

export function isShotType(value: unknown): value is ShotType {
  return typeof value === "string" && (SHOT_TYPES as readonly string[]).includes(value);
}
