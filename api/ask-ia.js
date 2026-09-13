// ============================================
// FONCTION SERVEUR : Assistant IA de XamÉtudes
// Appelée quand un élève mentionne @IA dans le chat
// Les clés secrètes (GEMINI_API_KEY, SUPABASE_SERVICE_ROLE_KEY) ne sont
// JAMAIS visibles côté navigateur : elles vivent uniquement ici, sur le serveur.
// ============================================

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    try {
        const { channelId, question, askerName } = req.body || {};

        if (!channelId || !question) {
            return res.status(400).json({ error: 'Paramètres manquants' });
        }

        const systemPrompt = "Tu es l'assistant pédagogique de XamÉtudes, une application utilisée par des élèves de Terminale S au Sénégal (programme scientifique : Mathématiques, Physique-Chimie, SVT, Philosophie, Français, Anglais). Un élève t'a mentionné (@IA) dans un salon de discussion de classe, souvent pour clarifier un désaccord entre camarades ou répondre à une question de cours. Réponds toujours en français, de façon claire, pédagogique et concise (150 mots maximum), adaptée au niveau Terminale. Si la question sort du programme du lycée, dis-le poliment et recentre si possible sur le programme scolaire.";

        // 1. Appel à l'API Gemini (Google AI Studio)
        const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    system_instruction: { parts: [{ text: systemPrompt }] },
                    contents: [
                        { role: 'user', parts: [{ text: `${askerName || 'Un élève'} demande : ${question}` }] }
                    ]
                })
            }
        );

        const geminiData = await geminiRes.json();

        if (!geminiRes.ok) {
            console.error('Erreur Gemini:', geminiData);
            return res.status(500).json({ error: 'Erreur IA' });
        }

        const answer = geminiData.candidates?.[0]?.content?.parts?.[0]?.text
            || "Désolé, je n'ai pas pu générer de réponse cette fois-ci.";

        // 2. Insertion directe du message dans Supabase (clé service_role = contourne les permissions normales)
        const insertRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/messages`, {
            method: 'POST',
            headers: {
                'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                channel_id: channelId,
                user_id: null,
                content: answer,
                type: 'ai'
            })
        });

        if (!insertRes.ok) {
            const errText = await insertRes.text();
            console.error('Erreur insertion Supabase:', errText);
            return res.status(500).json({ error: 'Erreur enregistrement du message' });
        }

        return res.status(200).json({ success: true });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Erreur serveur' });
    }
};
