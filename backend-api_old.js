import "https://deno.land/std@0.224.0/dotenv/load.ts";
import express from 'npm:express@4.18.2';
import cors from 'npm:cors@2.8.5';
import jwt from 'npm:jsonwebtoken@9.0.2';
import bcrypt from 'npm:bcryptjs@2.4.3';
import { createClient } from 'npm:@supabase/supabase-js@2.39.0';
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// Configuration con validazione
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_KEY');
const JWT_SECRET = Deno.env.get('JWT_SECRET') || 'dev-secret-change-in-production';
const PORT = parseInt(Deno.env.get('PORT') || '8000');

// Verifica configurazione
if (!supabaseUrl || !supabaseKey) {
  console.error('❌ ERRORE: Configura SUPABASE_URL e SUPABASE_SERVICE_KEY nei secrets!');
  console.error('\n📋 Setup Rapido:');
  console.error('1. Vai su https://supabase.com e crea un progetto');
  console.error('2. Dashboard → Settings → API');
  console.error('3. Copia Project URL e service_role key');
  console.error('4. Aggiungi i secrets nelle impostazioni dell\'app\n');
}

const supabase = supabaseUrl && supabaseKey 
  ? createClient(supabaseUrl, supabaseKey)
  : null;

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Middleware per verificare DB connesso
const requireDB = (req, res, next) => {
  if (!supabase) {
    return res.status(503).json({ 
      error: 'Database non configurato' && supabaseUrl,
      message: 'Configura SUPABASE_URL e SUPABASE_SERVICE_KEY nei secrets'
    });
  }
  next();
};

// Auth Middleware
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    database: supabase ? 'connected' : 'not configured',
    message: supabase ? 'Backend operativo' : 'Configura SUPABASE_URL e SUPABASE_SERVICE_KEY'
  });
});

// ==================== AUTH ENDPOINTS ====================

app.post('/auth/register', requireDB, async (req, res) => {
  try {
    const { email, password, full_name } = req.body;

    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const { data: newUser, error } = await supabase
      .from('users')
      .insert([{
        email,
        password: hashedPassword,
        full_name,
        role: 'user'
      }])
      .select()
      .single();

    if (error) throw error;

    const token = jwt.sign(
      { id: newUser.id, email: newUser.email, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      user: {
        id: newUser.id,
        email: newUser.email,
        full_name: newUser.full_name,
        role: newUser.role
      },
      token
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/auth/login', requireDB, async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role
      },
      token
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/auth/me', requireDB, authenticateToken, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, full_name, role, created_date')
      .eq('id', req.user.id)
      .single();

    if (error) throw error;

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/auth/me', requireDB, authenticateToken, async (req, res) => {
  try {
    const updates = req.body;
    delete updates.id;
    delete updates.email;
    delete updates.role;
    delete updates.password;

    const { data: user, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', req.user.id)
      .select()
      .single();

    if (error) throw error;

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/auth/logout', authenticateToken, (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

// ==================== ENTITIES CRUD ====================

app.get('/entities/:entityName', requireDB, authenticateToken, async (req, res) => {
  try {
    const { entityName } = req.params;
    const { sort, limit = 100, filter } = req.query;

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

    query = query.limit(parseInt(limit));

    const { data, error } = await query;

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/entities/:entityName/:id', requireDB, authenticateToken, async (req, res) => {
  try {
    const { entityName, id } = req.params;

    const { data, error } = await supabase
      .from(entityName.toLowerCase())
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(404).json({ error: 'Record not found' });
  }
});

app.post('/entities/:entityName', requireDB, authenticateToken, async (req, res) => {
  try {
    const { entityName } = req.params;
    const entityData = {
      ...req.body,
      created_by: req.user.email,
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from(entityName.toLowerCase())
      .insert([entityData])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/entities/:entityName/bulk', requireDB, authenticateToken, async (req, res) => {
  try {
    const { entityName } = req.params;
    const records = req.body.map(record => ({
      ...record,
      created_by: req.user.email,
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString()
    }));

    const { data, error } = await supabase
      .from(entityName.toLowerCase())
      .insert(records)
      .select();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/entities/:entityName/:id', requireDB, authenticateToken, async (req, res) => {
  try {
    const { entityName, id } = req.params;
    const updates = {
      ...req.body,
      updated_date: new Date().toISOString()
    };
    delete updates.id;
    delete updates.created_date;
    delete updates.created_by;

    const { data, error } = await supabase
      .from(entityName.toLowerCase())
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/entities/:entityName/:id', requireDB, authenticateToken, async (req, res) => {
  try {
    const { entityName, id } = req.params;

    const { error } = await supabase
      .from(entityName.toLowerCase())
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({ message: 'Deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== INTEGRATIONS ====================

app.post('/integrations/llm', authenticateToken, async (req, res) => {
  try {
    const { prompt, response_json_schema, add_context_from_internet, file_urls } = req.body;

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    const messages = [{ role: 'user', content: prompt }];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4-turbo-preview',
        messages,
        response_format: response_json_schema ? { type: 'json_object' } : undefined,
        temperature: 0.7
      })
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message);
    }

    const content = data.choices[0].message.content;

    if (response_json_schema) {
      try {
        const jsonResponse = JSON.parse(content);
        return res.json(jsonResponse);
      } catch (e) {
        return res.json({ raw_response: content });
      }
    }

    res.json({ response: content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/integrations/upload', requireDB, authenticateToken, async (req, res) => {
  try {
    const { file, filename } = req.body;

    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const buffer = Uint8Array.from(atob(file), c => c.charCodeAt(0));
    const filePath = `${req.user.id}/${Date.now()}_${filename || 'file'}`;
    
    const { data, error } = await supabase.storage
      .from('uploads')
      .upload(filePath, buffer, {
        contentType: 'application/octet-stream'
      });

    if (error) throw error;

    const { data: urlData } = supabase.storage
      .from('uploads')
      .getPublicUrl(filePath);

    res.json({ file_url: urlData.publicUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/integrations/email', authenticateToken, async (req, res) => {
  try {
    const { to, subject, body, from_name } = req.body;

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) {
      return res.status(500).json({ error: 'Email service not configured' });
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: `${from_name || 'Intent Flow'} <noreply@yourdomain.com>`,
        to: [to],
        subject,
        html: body
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to send email');
    }

    res.json({ message: 'Email sent successfully', id: data.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/integrations/generate-image', authenticateToken, async (req, res) => {
  try {
    const { prompt } = req.body;

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: '1024x1024'
      })
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message);
    }

    res.json({ url: data.data[0].url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== START SERVER ====================

//Deno.serve({ port: PORT }, app);
serve(app, { port: PORT });
console.log(`\n🚀 Backend API running on port ${PORT}`);
console.log(`📊 Health check: http://localhost:${PORT}/health\n`);

if (!supabase) {
  console.log('⚠️  Database non configurato - configura i secrets per usare l\'API\n');
}