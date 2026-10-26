import handler from "../../netlify/functions/borrar.mjs";
import { adaptar } from "../_entra.js";

export const onRequest = adaptar(handler);
