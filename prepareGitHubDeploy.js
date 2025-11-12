import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { boardId, repoName, githubToken } = await req.json();

        if (!boardId || !repoName || !githubToken) {
            return Response.json({ 
                error: 'Missing required parameters: boardId, repoName, githubToken' 
            }, { status: 400 });
        }

        console.log('Preparing GitHub deploy for board:', boardId);

        // Carica deployment
        const deployments = await base44.asServiceRole.entities.ProjectDeployment.filter({ 
            board_id: boardId 
        });

        if (deployments.length === 0) {
            return Response.json({ 
                error: 'No deployment found. Please deploy the project first.' 
            }, { status: 404 });
        }

        const deployment = deployments[0];
        
        if (!deployment.generated_files) {
            return Response.json({ 
                error: 'No generated files found in deployment' 
            }, { status: 404 });
        }

        // Carica board per info
        const board = await base44.asServiceRole.entities.Board.get(boardId);

        console.log('Building project files...');

        // Prepara struttura files per GitHub
        const files = {};

        // 1. README.md
        files['README.md'] = `# ${board.name}

Progetto generato da **Intent Flow Designer**

## 🚀 Deployment

Questo progetto è configurato per il deployment automatico su **Deno Deploy**.

### Auto-Deploy da GitHub
Ogni push su \`main\` triggera un deployment automatico.

## 📦 Struttura

- \`entities/\` - JSON schemas per le entities del database
- \`pages/\` - React pages dell'applicazione
- \`components/\` - React components riutilizzabili
- \`functions/\` - Backend API handlers (Deno)

## 🔧 Environment Variables

Configura questi secrets in Deno Deploy:

\`\`\`
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
JWT_SECRET=your-jwt-secret
OPENAI_API_KEY=sk-... (opzionale)
\`\`\`

## 🏃 Local Development

\`\`\`bash
# Installa Deno
curl -fsSL https://deno.land/install.sh | sh

# Run locally
deno task start
\`\`\`

## 📝 Deployment su Deno Deploy

1. Vai su https://dash.deno.com/new_project
2. Click "Deploy from GitHub"
3. Seleziona questo repository
4. Entry point: \`main.js\`
5. Configura Environment Variables
6. Deploy! 🎉

---

Generato con ❤️ da Intent Flow Designer
`;

        // 2. deno.json
        files['deno.json'] = JSON.stringify({
            tasks: {
                start: "deno run --allow-net --allow-env --allow-read main.js"
            },
            imports: {
                "npm:@supabase/supabase-js": "npm:@supabase/supabase-js@^2.39.0"
            }
        }, null, 2);

        // 3. .gitignore
        files['.gitignore'] = `.env
.env.local
.DS_Store
node_modules/
*.log
.vscode/
.idea/`;

        // 4. main.js (Entry point per Deno)
        files['main.js'] = `import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@^2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_KEY");

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    Deno.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log("🚀 Server starting...");

serve(async (req) => {
    const url = new URL(req.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle OPTIONS
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (path === '/health' || path === '/') {
        return new Response(
            JSON.stringify({ 
                status: 'ok', 
                message: '${board.name} API is running',
                timestamp: new Date().toISOString()
            }), 
            { 
                headers: { 
                    ...corsHeaders, 
                    'Content-Type': 'application/json' 
                } 
            }
        );
    }

    // API routes
    if (path.startsWith('/api/')) {
        try {
            // Qui puoi aggiungere le tue route API
            // Esempio: GET /api/users, POST /api/projects, etc.
            
            return new Response(
                JSON.stringify({ 
                    message: 'API endpoint not implemented yet',
                    path: path
                }), 
                { 
                    status: 404,
                    headers: { 
                        ...corsHeaders, 
                        'Content-Type': 'application/json' 
                    } 
                }
            );
        } catch (error) {
            console.error('API Error:', error);
            return new Response(
                JSON.stringify({ 
                    error: error.message 
                }), 
                { 
                    status: 500,
                    headers: { 
                        ...corsHeaders, 
                        'Content-Type': 'application/json' 
                    } 
                }
            );
        }
    }

    // 404
    return new Response(
        JSON.stringify({ error: 'Not found' }), 
        { 
            status: 404,
            headers: { 
                ...corsHeaders, 
                'Content-Type': 'application/json' 
            } 
        }
    );
});

console.log("✅ Server ready on port 8000");
`;

        // 5. Entities
        if (deployment.generated_files.entities) {
            Object.entries(deployment.generated_files.entities).forEach(([name, schema]) => {
                files[`entities/${name}.json`] = schema;
            });
        }

        // 6. Pages
        if (deployment.generated_files.pages) {
            Object.entries(deployment.generated_files.pages).forEach(([name, code]) => {
                files[`pages/${name}.jsx`] = code;
            });
        }

        // 7. Components
        if (deployment.generated_files.components) {
            Object.entries(deployment.generated_files.components).forEach(([name, code]) => {
                files[`components/${name}.jsx`] = code;
            });
        }

        // 8. Layout (se presente)
        if (deployment.generated_files.layout) {
            files['Layout.jsx'] = deployment.generated_files.layout;
        }

        console.log('Files prepared:', Object.keys(files).length);

        // Ora usa GitHub API per creare repo e push files
        console.log('Creating GitHub repository...');

        // 1. Crea repository
        const createRepoResponse = await fetch('https://api.github.com/user/repos', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${githubToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: repoName,
                description: `${board.name} - Generato da Intent Flow Designer`,
                private: false,
                auto_init: true
            })
        });

        if (!createRepoResponse.ok) {
            const error = await createRepoResponse.json();
            console.error('GitHub API error:', error);
            return Response.json({ 
                success: false,
                error: 'Failed to create GitHub repository',
                details: error.message || 'Unknown error'
            }, { status: 500 });
        }

        const repo = await createRepoResponse.json();
        console.log('Repository created:', repo.full_name);

        // 2. Get default branch SHA
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for GitHub to initialize
        
        const branchResponse = await fetch(
            `https://api.github.com/repos/${repo.full_name}/git/refs/heads/main`,
            {
                headers: {
                    'Authorization': `Bearer ${githubToken}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );

        let baseSHA;
        if (branchResponse.ok) {
            const branchData = await branchResponse.json();
            baseSHA = branchData.object.sha;
        }

        // 3. Create tree with all files
        const tree = Object.entries(files).map(([path, content]) => ({
            path: path,
            mode: '100644',
            type: 'blob',
            content: content
        }));

        const treeResponse = await fetch(
            `https://api.github.com/repos/${repo.full_name}/git/trees`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${githubToken}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tree: tree,
                    base_tree: baseSHA
                })
            }
        );

        if (!treeResponse.ok) {
            const error = await treeResponse.json();
            console.error('Failed to create tree:', error);
            return Response.json({ 
                success: false,
                error: 'Failed to create file tree',
                details: error.message
            }, { status: 500 });
        }

        const treeData = await treeResponse.json();

        // 4. Create commit
        const commitResponse = await fetch(
            `https://api.github.com/repos/${repo.full_name}/git/commits`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${githubToken}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: 'Initial commit from Intent Flow Designer',
                    tree: treeData.sha,
                    parents: baseSHA ? [baseSHA] : []
                })
            }
        );

        if (!commitResponse.ok) {
            const error = await commitResponse.json();
            console.error('Failed to create commit:', error);
            return Response.json({ 
                success: false,
                error: 'Failed to create commit',
                details: error.message
            }, { status: 500 });
        }

        const commitData = await commitResponse.json();

        // 5. Update branch reference
        await fetch(
            `https://api.github.com/repos/${repo.full_name}/git/refs/heads/main`,
            {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${githubToken}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    sha: commitData.sha,
                    force: true
                })
            }
        );

        console.log('✅ Files pushed to GitHub');

        return Response.json({
            success: true,
            repository: {
                name: repo.name,
                full_name: repo.full_name,
                html_url: repo.html_url,
                clone_url: repo.clone_url
            },
            files_count: Object.keys(files).length,
            next_steps: {
                deno_deploy_url: 'https://dash.deno.com/new_project',
                entry_point: 'main.js',
                required_env_vars: ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'JWT_SECRET']
            }
        });

    } catch (error) {
        console.error('Error preparing GitHub deploy:', error);
        return Response.json({ 
            success: false,
            error: error.message || 'Unknown error',
            stack: error.stack
        }, { status: 500 });
    }
});