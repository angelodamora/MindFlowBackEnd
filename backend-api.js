// CARICA IL FILE .env PRIMA DI TUTTO
import "https://deno.land/std@0.224.0/dotenv/load.ts";

// IMPORT NATIVI DENO (OAK)
import { Application, Router } from "https://deno.land/x/oak@v16.0.0/mod.ts";

// IMPORT NPM (PER LA LOGICA)
import jwt from 'npm:jsonwebtoken@9.0.2';
import bcrypt from 'npm:bcryptjs@2.4.3';
import { createClient } from 'npm:@supabase/supabase-js@2.39.0';

// === STESSA CONFIGURAZIONE ===
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_KEY');
const JWT_SECRET = Deno.env.get('JWT_SECRET') || 'dev-secret-change-in-production';
const PORT = parseInt(Deno.env.get('PORT'));

// (Stesso controllo di configurazione)
if (!supabaseUrl || !supabaseKey) {
  console.error('❌ ERRORE: Configura SUPABASE_URL e SUPABASE_SERVICE_KEY nei secrets!');
  // ... (stesso log di errore)
}

const supabase = supabaseUrl && supabaseKey 
  ? createClient(supabaseUrl, supabaseKey)
  : null;

// OAK: Inizializza l'app Oak e il Router
const app = new Application();
const router = new Router();

// ==================== MIDDLEWARE ====================

// OAK: Middleware per CORS (MANUALE - NESSUNA DIPENDENZA ESTERNA)
app.use(async (ctx, next) => {
  const origin = ctx.request.headers.get('Origin');
  if (origin === 'http://localhost:5173') {
    ctx.response.headers.set('Access-Control-Allow-Origin', 'http://localhost:5173');
  }
  
  ctx.response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  ctx.response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (ctx.request.method === 'OPTIONS') {
    ctx.response.status = 204;
  } else {
    await next();
  }
});

// OAK: Middleware per gestire gli errori
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    // Log dell'errore REALE sul server
    console.error("ERRORE NON GESTITO:", err); 
    
    ctx.response.status = err.status || 500;
    // Invia il messaggio di errore al client
    ctx.response.body = { error: err.message || "Internal Server Error" }; 
  }
});

// OAK: Middleware per verificare DB (usa 'ctx' e 'next')
const requireDB = async (ctx, next) => {
  if (!supabase) {
    ctx.response.status = 503;
    ctx.response.body = { 
      error: 'Database non configurato',
      message: 'Configura SUPABASE_URL e SUPABASE_SERVICE_KEY nei secrets'
    };
    return;
  }
  await next();
};

// OAK: Auth Middleware (usa 'ctx' e 'next')
const authenticateToken = async (ctx, next) => {
  const authHeader = ctx.request.headers.get('authorization');
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    ctx.response.status = 401;
    ctx.response.body = { error: 'Access token required' };
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    ctx.state.user = decoded;
    await next();
  } catch (error) {
    ctx.response.status = 403;
    ctx.response.body = { error: 'Invalid token' };
  }
};

// ==================== HEALTH CHECK ====================
router.get('/health', (ctx) => {
  console.log("[DEBUG OAK] RICHIESTA /health RICEVUTA!");
  ctx.response.body = { 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    database: supabase ? 'connected' : 'not configured',
    message: 'SONO IL SERVER OAK NATIVO E FUNZIONANTE'
  };
});

// ==================== AUTH ENDPOINTS ====================

router.post('/auth/register', requireDB, async (ctx) => {
    // === CORREZIONE QUI ===
   // const { email, password, full_name } = await ctx.request.body.json();
       const body = await ctx.request.body.json();
       const email = body.email ? body.email.trim().toLowerCase() : '';
       const password = body.password ? body.password.trim() : '';
       const full_name = body.full_name ? body.full_name.trim() : '';
	   console.log(`[DEBUG REG] REGISTRAZIONE: Ricevuta password in chiaro: "${password}"`);
    const { data: existingUser } = await supabase
      .from('users').select('*').eq('email', email).single();

    if (existingUser) {
      ctx.response.status = 400;
      ctx.response.body = { error: 'User already exists' };
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const { data: newUser, error } = await supabase
      .from('users')
      .insert([{ email, password: hashedPassword, full_name, role: 'user' }])
      .select().single();
    if (error) throw error;

    const token = jwt.sign(
      { id: newUser.id, email: newUser.email, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    ctx.response.body = {
      user: { id: newUser.id, email: newUser.email, full_name: newUser.full_name, role: newUser.role },
      token
    };
});

router.post('/auth/login', requireDB, async (ctx) => {
    console.log("[DEBUG OAK] Richiesta /auth/login ricevuta!");
    
    // === CORREZIONE QUI ===
    //const { email, password } = await ctx.request.body.json();
	    const body = await ctx.request.body.json();
	    const email = body.email ? body.email.trim().toLowerCase() : '';
	    const password = body.password ? body.password.trim() : '';
    const { data: user, error } = await supabase
      .from('users').select('*').eq('email', email).single();

    if (error || !user) {
      console.warn(`[DEBUG OAK] Login fallito: credenziali non valide per ${email}`);
      ctx.response.status = 401;
      ctx.response.body = { error: 'Invalid credentials' };
      return;
    }

    const validPassword = await bcrypt.compare(password, user.password.trim());
    if (!validPassword) {
      console.warn(`[DEBUG OAK] Login fallito: password errata per ${email}`);
      ctx.response.status = 401;
      ctx.response.body = { error: 'Invalid credentials' };
	  console.log("[DEBUG] Password in chiaro ricevuta:", password);
	  console.log("[DEBUG] Hash recuperato dal DB:", user.password);
	  
      return;
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    console.log(`[DEBUG OAK] Login Riuscito per ${email}`);
    ctx.response.body = {
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
      token
    };
});

router.get('/auth/me', requireDB, authenticateToken, async (ctx) => {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, full_name, role, created_date')
      .eq('id', ctx.state.user.id)
      .single();
    if (error) throw error;
    ctx.response.body = user;
});

router.put('/auth/me', requireDB, authenticateToken, async (ctx) => {
    // === CORREZIONE QUI ===
    const updates = await ctx.request.body.json();
    delete updates.id;
    delete updates.email;
    delete updates.role;
    delete updates.password;

    const { data: user, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', ctx.state.user.id)
      .select()
      .single();
    if (error) throw error;
    ctx.response.body = user;
});

router.post('/auth/logout', authenticateToken, (ctx) => {
  ctx.response.body = { message: 'Logged out successfully' };
});

// ==================== ENTITIES CRUD ====================

router.get('/entities/:entityName', requireDB, authenticateToken, async (ctx) => {
    const { entityName } = ctx.params;
    const params = ctx.request.url.searchParams;
    const sort = params.get('sort');
    const limit = parseInt(params.get('limit') || '100');
    const filter = params.get('filter');
    let query = supabase.from(entityName.toLowerCase()).select('*');
    if (filter) {
      const filters = JSON.parse(filter);
      Object.entries(filters).forEach(([key, value]) => {
        query = query.eq(key, value);
      });
    }
    if (sort) {
      const ascending = !sort.startsWith('-');
      const column = sort.replace('-', '');
      query = query.order(column, { ascending });
    }
    query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    ctx.response.body = data || [];
});

router.get('/entities/:entityName/:id', requireDB, authenticateToken, async (ctx) => {
    const { entityName, id } = ctx.params;
    const { data, error } = await supabase
      .from(entityName.toLowerCase()).select('*').eq('id', id).single();
    if (error) throw error;
    ctx.response.body = data;
});

router.post('/entities/:entityName', requireDB, authenticateToken, async (ctx) => {
    const { entityName } = ctx.params;
    // === CORREZIONE QUI ===
    const body = await ctx.request.body.json();
    const entityData = {
      ...body,
      created_by: ctx.state.user.email,
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString()
    };
    const { data, error } = await supabase
      .from(entityName.toLowerCase()).insert([entityData]).select().single();
    if (error) throw error;
    ctx.response.status = 201;
    ctx.response.body = data;
});

router.post('/entities/:entityName/bulk', requireDB, authenticateToken, async (ctx) => {
    const { entityName } = ctx.params;
    // === CORREZIONE QUI ===
    const records = (await ctx.request.body.json()).map(record => ({
      ...record,
      created_by: ctx.state.user.email,
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString()
    }));
    const { data, error } = await supabase
      .from(entityName.toLowerCase()).insert(records).select();
    if (error) throw error;
    ctx.response.status = 201;
    ctx.response.body = data;
});

router.put('/entities/:entityName/:id', requireDB, authenticateToken, async (ctx) => {
    const { entityName, id } = ctx.params;
    // === CORREZIONE QUI ===
    const body = await ctx.request.body.json();
    const updates = {
      ...body,
      updated_date: new Date().toISOString()
    };
    delete updates.id;
    delete updates.created_date;
    delete updates.created_by;
    const { data, error } = await supabase
      .from(entityName.toLowerCase()).update(updates).eq('id', id).select().single();
    if (error) throw error;
    ctx.response.body = data;
});

router.delete('/entities/:entityName/:id', requireDB, authenticateToken, async (ctx) => {
    const { entityName, id } = ctx.params;
    const { error } = await supabase
      .from(entityName.toLowerCase()).delete().eq('id', id);
    if (error) throw error;
    ctx.response.body = { message: 'Deleted successfully' };
});

// ==================== INTEGRATIONS ====================

router.post('/integrations/llm', authenticateToken, async (ctx) => {
    // === CORREZIONE QUI ===
    const { prompt, response_json_schema } = await ctx.request.body.json();
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      ctx.response.status = 500;
      ctx.response.body = { error: 'OpenAI API key not configured' };
      return;
    }
    const messages = [{ role: 'user', content: prompt }];
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4-turbo-preview',
        messages,
        response_format: response_json_schema ? { type: 'json_object' } : undefined,
        temperature: 0.7
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    
    const content = data.choices[0].message.content;
    if (response_json_schema) {
      try {
        ctx.response.body = JSON.parse(content);
      } catch (e) {
        ctx.response.body = { raw_response: content };
      }
    } else {
      ctx.response.body = { response: content };
    }
});

router.post('/integrations/upload', requireDB, authenticateToken, async (ctx) => {
    // === CORREZIONE QUI ===
    const { file, filename } = await ctx.request.body.json();
    if (!file) {
      ctx.response.status = 400;
      ctx.response.body = { error: 'No file provided' };
      return;
    }
    const buffer = Uint8Array.from(atob(file), c => c.charCodeAt(0));
    const filePath = `${ctx.state.user.id}/${Date.now()}_${filename || 'file'}`;
    
    const { data, error } = await supabase.storage
      .from('uploads').upload(filePath, buffer, { contentType: 'application/octet-stream' });
    if (error) throw error;
    const { data: urlData } = supabase.storage.from('uploads').getPublicUrl(filePath);
    ctx.response.body = { file_url: urlData.publicUrl };
});

router.post('/integrations/email', authenticateToken, async (ctx) => {
    // === CORREZIONE QUI ===
    const { to, subject, body, from_name } = await ctx.request.body.json();
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) {
      ctx.response.status = 500;
      ctx.response.body = { error: 'Email service not configured' };
      return;
    }
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${from_name || 'Intent Flow'} <noreply@yourdomain.com>`,
        to: [to], subject, html: body
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Failed to send email');
    ctx.response.body = { message: 'Email sent successfully', id: data.id };
});

router.post('/integrations/generate-image', authenticateToken, async (ctx) => {
    // === CORREZIONE QUI ===
    const { prompt } = await ctx.request.body.json();
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      ctx.response.status = 500;
      ctx.response.body = { error: 'OpenAI API key not configured' };
      return;
    }
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: '1024x1024' })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    ctx.response.body = { url: data.data[0].url };
});

// ==================== START SERVER ====================
app.use(router.routes());
app.use(router.allowedMethods());

console.log(`\n🚀 Backend API (Oak) running on port ${PORT}`);
console.log(`📊 Health check: http://localhost:${PORT}/health\n`);
if (!supabase) {
  console.log('⚠️  Database non configurato - configura i secrets per usare l\'API\n');
}

await app.listen({ port: PORT });