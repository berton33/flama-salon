/* Conexión a Supabase. La clave anon es pública por diseño: la protección
 * está en la base (esquema flama no expuesto, funciones flama_* y PIN). */
window.FLAMA_CONFIG = {
  supabaseUrl: 'https://avupnoituvcqifgrvkve.supabase.co',
  supabaseAnonKey: 'sb_publishable_Kt2lx5lzilARZ03hPUDDQA_xfx5yLEC',
  // Billetes del contador de caja, de mayor a menor (planilla CONTADOR BILLETE Y GASTOS).
  billetes: [20000, 10000, 2000, 1000, 500, 200, 100]
};
