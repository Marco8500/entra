import handler from "../../netlify/functions/stripe-webhook.mjs";
import { adaptar } from "../_entra.js";

export const onRequest = adaptar(handler);
