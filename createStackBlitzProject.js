import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { files, projectName } = await req.json();

        if (!files || !projectName) {
            return Response.json({ 
                error: 'Missing required parameters: files and projectName' 
            }, { status: 400 });
        }

        // Prepara il payload per StackBlitz usando il formato corretto
        // StackBlitz accetta progetti via POST form o via GitHub
        // Generiamo un oggetto che può essere usato con sdk.openProject()
        
        const projectPayload = {
            title: projectName,
            description: `Progetto generato da Intent Flow: ${projectName}`,
            template: 'node', // Template base Node.js
            files: {}
        };

        // Converti i file nel formato StackBlitz
        Object.entries(files).forEach(([path, fileData]) => {
            projectPayload.files[path] = fileData.content;
        });

        // Invece di usare l'API (che potrebbe non funzionare senza auth),
        // generiamo un payload che può essere usato con StackBlitz SDK
        // o con un form POST diretto
        
        // Comprimi il payload in base64 per URL brevi
        const payloadString = JSON.stringify(projectPayload);
        const encoder = new TextEncoder();
        const data = encoder.encode(payloadString);
        
        // Comprimi usando gzip
        const compressed = await new Response(
            new ReadableStream({
                start(controller) {
                    controller.enqueue(data);
                    controller.close();
                }
            }).pipeThrough(new CompressionStream('gzip'))
        ).arrayBuffer();
        
        // Converti in base64
        const base64 = btoa(String.fromCharCode(...new Uint8Array(compressed)));
        
        // Genera un ID univoco per il progetto
        const projectId = `intent-flow-${Date.now()}`;
        
        // Restituisci sia il payload che un URL utilizzabile
        return Response.json({
            success: true,
            projectId: projectId,
            payload: projectPayload,
            payloadCompressed: base64,
            // URL che può essere usato per aprire il progetto
            // Nota: questo richiederà l'uso del SDK nel client
            instructions: 'Use the payload with StackBlitz SDK or create via form POST'
        });

    } catch (error) {
        console.error('Error creating StackBlitz project:', error);
        return Response.json({ 
            success: false,
            error: error.message || 'Unknown error'
        }, { status: 500 });
    }
});