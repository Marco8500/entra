import handler from "../../netlify/functions/repaso.mjs";
import { adaptar } from "../_entra.js";

export const onRequest = adaptar(handler);
