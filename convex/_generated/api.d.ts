/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as audit from "../audit.js";
import type * as httpFetch from "../httpFetch.js";
import type * as jelly from "../jelly.js";
import type * as jellySecurity from "../jellySecurity.js";
import type * as jellyhunt_audit from "../jellyhunt/audit.js";
import type * as jellyhunt_campaigns from "../jellyhunt/campaigns.js";
import type * as jellyhunt_missions from "../jellyhunt/missions.js";
import type * as jellyhunt_places from "../jellyhunt/places.js";
import type * as jellyhunt_publicIds from "../jellyhunt/publicIds.js";
import type * as jellyhunt_security from "../jellyhunt/security.js";
import type * as jellyhunt_validators from "../jellyhunt/validators.js";
import type * as missions from "../missions.js";
import type * as security from "../security.js";
import type * as submissions from "../submissions.js";
import type * as validation from "../validation.js";
import type * as workflow from "../workflow.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  audit: typeof audit;
  httpFetch: typeof httpFetch;
  jelly: typeof jelly;
  jellySecurity: typeof jellySecurity;
  "jellyhunt/audit": typeof jellyhunt_audit;
  "jellyhunt/campaigns": typeof jellyhunt_campaigns;
  "jellyhunt/missions": typeof jellyhunt_missions;
  "jellyhunt/places": typeof jellyhunt_places;
  "jellyhunt/publicIds": typeof jellyhunt_publicIds;
  "jellyhunt/security": typeof jellyhunt_security;
  "jellyhunt/validators": typeof jellyhunt_validators;
  missions: typeof missions;
  security: typeof security;
  submissions: typeof submissions;
  validation: typeof validation;
  workflow: typeof workflow;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
