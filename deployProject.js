import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    console.log('=== DEPLOY PROJECT START ===');
    
    try {
        const base44 = createClientFromRequest(req);
        
        // Verifica autenticazione
        let user;
        try {
            user = await base44.auth.me();
            console.log('✓ User authenticated:', user.email);
        } catch (authError) {
            console.error('✗ Auth error:', authError);
            return Response.json({ 
                success: false,
                error: 'Unauthorized - Please login',
                details: authError.message 
            }, { status: 401 });
        }

        // Parse request body
        let boardId;
        try {
            const body = await req.json();
            boardId = body.boardId;
            console.log('✓ Board ID:', boardId);
        } catch (parseError) {
            console.error('✗ Parse error:', parseError);
            return Response.json({ 
                success: false,
                error: 'Invalid request body',
                details: parseError.message 
            }, { status: 400 });
        }

        if (!boardId) {
            console.error('✗ Missing board ID');
            return Response.json({ 
                success: false,
                error: 'Board ID is required' 
            }, { status: 400 });
        }

        // Carica il progetto
        let board;
        try {
            board = await base44.asServiceRole.entities.Board.get(boardId);
            console.log('✓ Board loaded:', board.name);
        } catch (boardError) {
            console.error('✗ Board error:', boardError);
            return Response.json({ 
                success: false,
                error: 'Board not found',
                details: boardError.message 
            }, { status: 404 });
        }

        if (!board) {
            console.error('✗ Board is null');
            return Response.json({ 
                success: false,
                error: 'Board not found' 
            }, { status: 404 });
        }

        const nodes = board.nodes || [];
        console.log('✓ Nodes count:', nodes.length);

        // Validazione: almeno 1 nodo
        if (nodes.length === 0) {
            console.error('✗ Board has no nodes');
            return Response.json({ 
                success: false,
                error: 'Il progetto non ha nodi. Aggiungi almeno un Intent prima di fare deploy.',
                details: 'Empty board'
            }, { status: 400 });
        }

        // Carica dati correlati
        let devClasses, personas, useCases;
        try {
            [devClasses, personas, useCases] = await Promise.all([
                base44.asServiceRole.entities.DevelopmentClass.filter({ board_id: boardId }),
                base44.asServiceRole.entities.Persona.filter({ board_id: boardId }),
                base44.asServiceRole.entities.UseCase.filter({ board_id: boardId })
            ]);
            console.log('✓ Related data loaded:', {
                devClasses: devClasses.length,
                personas: personas.length,
                useCases: useCases.length
            });
        } catch (dataError) {
            console.error('✗ Error loading related data:', dataError);
            // Continua comunque con array vuoti
            devClasses = [];
            personas = [];
            useCases = [];
        }

        // Inizializza o aggiorna deployment
        const existingDeployments = await base44.asServiceRole.entities.ProjectDeployment.filter({ board_id: boardId });
        
        let deployment;
        const startTime = Date.now();
        
        const initialLog = {
            timestamp: new Date().toISOString(),
            message: 'Inizio generazione app...',
            level: 'info'
        };

        const initialData = {
            board_id: boardId,
            deployment_status: 'building',
            deployment_logs: [initialLog]
        };

        try {
            if (existingDeployments.length > 0) {
                deployment = await base44.asServiceRole.entities.ProjectDeployment.update(
                    existingDeployments[0].id,
                    initialData
                );
                console.log('✓ Deployment updated:', deployment.id);
            } else {
                deployment = await base44.asServiceRole.entities.ProjectDeployment.create(initialData);
                console.log('✓ Deployment created:', deployment.id);
            }
        } catch (deployError) {
            console.error('✗ Error creating deployment record:', deployError);
            return Response.json({ 
                success: false,
                error: 'Failed to create deployment record',
                details: deployError.message 
            }, { status: 500 });
        }

        try {
            // Genera Master Prompt
            console.log('→ Generating master prompt...');
            const masterPrompt = generateMasterPrompt(board, nodes, devClasses, personas, useCases);
            console.log('✓ Master prompt generated, length:', masterPrompt.length);

            // Prompt per AI
            const aiPrompt = `${masterPrompt}

GENERA UN'APPLICAZIONE WEB COMPLETA E FUNZIONANTE.

Crea SOLO questi elementi essenziali:
1. 2-3 entities principali (JSON schema)
2. 2-3 pagine React principali
3. 1-2 componenti riutilizzabili (se necessario)
4. Layout opzionale

Regole importanti:
- Usa import { base44 } from '@/api/base44Client' per le entities
- Usa shadcn/ui components da @/components/ui/
- Usa Tailwind CSS per lo styling
- Usa SOLO icone lucide-react che esistono
- Mantieni il codice SEMPLICE e FUNZIONANTE
- NON includere spiegazioni, SOLO codice valido
- Ogni file deve essere sintatticamente corretto

IMPORTANTE: Rispondi SOLO con JSON valido nel formato specificato.`;

            console.log('→ Calling AI (prompt length:', aiPrompt.length, ')');

            // Chiama AI con timeout e retry
            let result;
            try {
                result = await base44.integrations.Core.InvokeLLM({
                    prompt: aiPrompt,
                    response_json_schema: {
                        type: "object",
                        properties: {
                            entities: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        name: { type: "string" },
                                        schema: { type: "object" }
                                    },
                                    required: ["name", "schema"]
                                }
                            },
                            pages: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        name: { type: "string" },
                                        code: { type: "string" }
                                    },
                                    required: ["name", "code"]
                                }
                            },
                            components: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        name: { type: "string" },
                                        code: { type: "string" }
                                    }
                                }
                            },
                            layout: {
                                type: "object",
                                properties: {
                                    code: { type: "string" }
                                }
                            }
                        },
                        required: ["entities", "pages"]
                    }
                });
                console.log('✓ AI response received');
            } catch (aiError) {
                console.error('✗ AI Error:', aiError);
                
                const errorLog = {
                    timestamp: new Date().toISOString(),
                    message: `AI Error: ${aiError.message}`,
                    level: 'error'
                };

                await base44.asServiceRole.entities.ProjectDeployment.update(deployment.id, {
                    deployment_status: 'failed',
                    deployment_logs: [initialLog, errorLog]
                });

                return Response.json({ 
                    success: false,
                    error: 'AI generation failed',
                    details: aiError.message,
                    hint: 'Verifica che OPENAI_API_KEY sia configurato nei secrets di Base44'
                }, { status: 500 });
            }

            // Valida risposta AI
            if (!result || typeof result !== 'object') {
                console.error('✗ Invalid AI response:', result);
                throw new Error('AI returned invalid format');
            }

            if (!result.entities || !Array.isArray(result.entities)) {
                console.error('✗ Missing entities in AI response');
                result.entities = [];
            }

            if (!result.pages || !Array.isArray(result.pages)) {
                console.error('✗ Missing pages in AI response');
                result.pages = [];
            }

            console.log('✓ AI response validated:', {
                entities: result.entities.length,
                pages: result.pages.length,
                components: result.components?.length || 0
            });

            // Assembla il codice generato
            let fullCode = `// ====================================\n// Progetto: ${board.name}\n// Generato: ${new Date().toLocaleString('it-IT')}\n// ====================================\n\n`;

            const generatedFiles = { entities: {}, pages: {}, components: {}, layout: null };
            
            // Process Entities
            console.log('→ Processing entities...');
            for (const entity of result.entities) {
                try {
                    const schema = JSON.stringify(entity.schema, null, 2);
                    generatedFiles.entities[entity.name] = schema;
                    fullCode += `// Entity: ${entity.name}\n${schema}\n\n`;
                } catch (e) {
                    console.error('✗ Error processing entity:', entity.name, e);
                }
            }

            // Process Layout
            if (result.layout?.code) {
                console.log('→ Processing layout...');
                const layoutCode = extractCode(result.layout.code);
                generatedFiles.layout = layoutCode;
                fullCode += `// LAYOUT\n${layoutCode}\n\n`;
            }

            // Process Pages
            console.log('→ Processing pages...');
            for (const page of result.pages) {
                try {
                    const pageCode = extractCode(page.code);
                    generatedFiles.pages[page.name] = pageCode;
                    fullCode += `// Page: ${page.name}\n${pageCode}\n\n`;
                } catch (e) {
                    console.error('✗ Error processing page:', page.name, e);
                }
            }

            // Process Components
            if (result.components && Array.isArray(result.components)) {
                console.log('→ Processing components...');
                for (const component of result.components) {
                    try {
                        const componentCode = extractCode(component.code);
                        generatedFiles.components[component.name] = componentCode;
                        fullCode += `// Component: ${component.name}\n${componentCode}\n\n`;
                    } catch (e) {
                        console.error('✗ Error processing component:', component.name, e);
                    }
                }
            }

            // Calcola metriche
            const endTime = Date.now();
            const totalLines = fullCode.split('\n').length;
            const metrics = {
                total_classes: devClasses.length,
                total_entities: Object.keys(generatedFiles.entities).length,
                total_pages: Object.keys(generatedFiles.pages).length,
                total_components: Object.keys(generatedFiles.components).length,
                total_lines: totalLines,
                estimated_complexity: totalLines < 500 ? 'Bassa' : totalLines < 2000 ? 'Media' : 'Alta',
                deployment_time_seconds: Math.round((endTime - startTime) / 1000)
            };

            console.log('✓ Deployment metrics:', metrics);

            const successLog = {
                timestamp: new Date().toISOString(),
                message: `Deployment completato in ${metrics.deployment_time_seconds}s: ${metrics.total_entities} entities, ${metrics.total_pages} pages, ${metrics.total_components} components`,
                level: 'info'
            };

            // Salva deployment completato
            const finalDeployment = await base44.asServiceRole.entities.ProjectDeployment.update(
                deployment.id,
                {
                    deployment_status: 'deployed',
                    deployed_code: fullCode,
                    technical_specification: result,
                    generated_files: generatedFiles,
                    metrics: metrics,
                    last_deployed_at: new Date().toISOString(),
                    deployment_logs: [initialLog, successLog]
                }
            );

            console.log('✓ Deployment completed successfully');
            console.log('=== DEPLOY PROJECT END (SUCCESS) ===');

            return Response.json({
                success: true,
                deployment: finalDeployment,
                metrics: metrics
            });

        } catch (innerError) {
            console.error('✗ Inner deployment error:', innerError);
            console.error('Stack:', innerError.stack);
            
            const errorLog = {
                timestamp: new Date().toISOString(),
                message: `Deployment fallito: ${innerError.message}`,
                level: 'error'
            };

            try {
                await base44.asServiceRole.entities.ProjectDeployment.update(deployment.id, {
                    deployment_status: 'failed',
                    deployment_logs: [initialLog, errorLog]
                });
            } catch (updateError) {
                console.error('✗ Failed to update deployment status:', updateError);
            }

            return Response.json({ 
                success: false,
                error: innerError.message,
                stack: innerError.stack,
                hint: 'Check function logs for details'
            }, { status: 500 });
        }

    } catch (error) {
        console.error('✗ CRITICAL ERROR:', error);
        console.error('Stack:', error.stack);
        console.log('=== DEPLOY PROJECT END (ERROR) ===');
        
        return Response.json({ 
            success: false,
            error: error.message || 'Unknown error',
            stack: error.stack,
            hint: 'Controlla i logs della funzione per dettagli'
        }, { status: 500 });
    }
});

function extractCode(codeString) {
    if (!codeString) return '';
    const codeMatch = codeString.match(/```(?:jsx?|javascript)?\n([\s\S]*?)```/);
    return codeMatch ? codeMatch[1].trim() : codeString.trim();
}

function generateMasterPrompt(board, nodes, devClasses, personas, useCases) {
    const level0Intents = nodes.filter(n => n.data?.level === 0);
    
    let prompt = `# Master Prompt - Applicazione: ${board.name}\n\n`;
    
    if (board.description) {
        prompt += `## Descrizione Progetto\n${board.description}\n\n`;
    }
    
    prompt += `## Obiettivi Principali\n\n`;
    
    if (level0Intents.length > 0) {
        level0Intents.forEach(node => {
            prompt += `- ${node.data?.objective || node.data?.title || 'N/A'}\n`;
        });
    } else {
        prompt += `- Creare un'applicazione web funzionante basata sul progetto ${board.name}\n`;
    }
    prompt += `\n`;

    if (personas && personas.length > 0) {
        prompt += `## Personas\n\n`;
        personas.slice(0, 3).forEach(persona => {
            prompt += `**${persona.name}**: ${persona.description || 'N/A'}\n`;
        });
        prompt += `\n`;
    }

    if (useCases && useCases.length > 0) {
        prompt += `## Casi d'Uso Principali\n\n`;
        useCases.slice(0, 3).forEach(uc => {
            prompt += `### ${uc.title}\n`;
            if (uc.steps && uc.steps.length > 0) {
                prompt += `Steps: ${uc.steps.map(s => s.action).join(' → ')}\n`;
            }
            prompt += `\n`;
        });
    }

    if (devClasses && devClasses.length > 0) {
        prompt += `## Componenti Architetturali\n\n`;
        devClasses.slice(0, 5).forEach(cls => {
            prompt += `**${cls.name}**: ${cls.description || 'N/A'}\n`;
        });
        prompt += `\n`;
    }

    if (nodes && nodes.length > 0) {
        prompt += `## Funzionalità Chiave\n\n`;
        nodes.filter(n => (n.data?.level || 0) <= 1).slice(0, 10).forEach(node => {
            prompt += `- [L${node.data?.level || 0}] ${node.data?.title || 'N/A'}: ${node.data?.objective || ''}\n`;
        });
    }

    return prompt;
}