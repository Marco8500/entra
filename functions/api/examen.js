import handler from "../../netlify/functions/examen.mjs";
import { adaptar } from "../_entra.js";

export const onRequest = adaptar(handler);
