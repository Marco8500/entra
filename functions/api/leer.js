import handler from "../../netlify/functions/leer.mjs";
import { adaptar } from "../_entra.js";

export const onRequest = adaptar(handler);
