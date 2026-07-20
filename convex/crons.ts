import { cronJobs } from "convex/server";
import { registerJellyhuntCrons } from "./jellyhunt/registerCrons";

const crons = cronJobs();

registerJellyhuntCrons(crons);

export default crons;
