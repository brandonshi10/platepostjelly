import { z } from "zod";

export const PlaceResponse = z.object({
  placePublicId: z.string(),
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
});
export type PlaceResponse = z.infer<typeof PlaceResponse>;
