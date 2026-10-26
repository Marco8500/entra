import handler from "../../netlify/functions/cuenta.mjs";
import { adaptar } from "../_entra.js";

export const onRequest = adaptar(handler);
