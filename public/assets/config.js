// Rellena con los datos de tu proyecto de Supabase (Project Settings → API).
// La "anon key" es pública por diseño: la seguridad la ponen las políticas RLS.
const ENTRA_LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);

window.ENTRA_CONFIG = ENTRA_LOCAL
  ? {
      // Desarrollo local (`npx supabase start`): claves de demostración fijas de Supabase local
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
      PRECIO_PRO: "3,99 €/mes",
      CONTACTO: "hola@tudominio.com",
    }
  : {
      SUPABASE_URL: "https://pabuoxrtijtldxzmyeqn.supabase.co",
      SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhYnVveHJ0aWp0bGR4em15ZXFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5NTI2NTcsImV4cCI6MjEwODUyODY1N30.UnKRD0tSAlfTcpHd8S0GO4Mw9s9310OnIsXxxa2FLZU",
      PRECIO_PRO: "3,99 €/mes",
      CONTACTO: "hola@tudominio.com",
    };
