import handler from "../../netlify/functions/corregir.mjs";
import { adaptar } from "../_entra.js";

export const onRequest = adaptar(handler);
