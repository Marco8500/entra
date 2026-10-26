import handler from "../../netlify/functions/pago.mjs";
import { adaptar } from "../_entra.js";

export const onRequest = adaptar(handler);
