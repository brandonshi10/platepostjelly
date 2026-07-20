import { httpRouter } from "convex/server";
import { registerJellyhuntHttpRoutes } from "./jellyhunt/registerHttpRoutes";

const http = httpRouter();

registerJellyhuntHttpRoutes(http);

export default http;
