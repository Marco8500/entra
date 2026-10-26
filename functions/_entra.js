// Adaptador de Cloudflare Pages: las funciones viven en netlify/functions (formato Request → Response)
// y aquí solo se les pasan las variables de entorno y el enlace a la IA de Cloudflare
export const adaptar = (handler) => (ctx) => {
  globalThis.__ENTRA_ENV = ctx.env;
  globalThis.__ENTRA_AI = ctx.env.AI;
  return handler(ctx.request, ctx);
};
