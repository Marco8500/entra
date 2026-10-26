import handler from "../../netlify/functions/chat.mjs";
import { adaptar } from "../_entra.js";

export const onRequest = adaptar(handler);
