// ============================================================
// api/analyser-cours.js
// Fonction serverless Vercel — "Professeur IA" de XamÉtudes
//
// Reçoit un PDF de cours (base64) + un message optionnel de l'élève
// + userId. Gemini lit le PDF, déduit lui-même un titre et une
// matière, et produit un résumé structuré. Une nouvelle conversation
// (type='cours') est créée dans resumes_cours, et le message de
// l'élève + le résumé de l'IA sont enregistrés comme les deux
// premiers messages de son fil de chat.
//
// Variables d'environnement Vercel nécessaires (déjà configurées) :
//   GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// LIMITE : le plan Vercel Hobby limite le corps d'une requête
// serverless à 4,5 Mo. Le PDF encodé en base64 grossit d'environ
// 33 %, donc garder les PDF sous ~3 Mo côté élève.
// ============================================================

const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  try {
    const { pdfBase64, message, userId } = req.body;

    if (!pdfBase64 || !userId) {
      return res.status(400).json({ error: 'Champs manquants : pdfBase64 et userId sont requis' });
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // --- 1. Appel à Gemini avec le PDF en pièce jointe (multimodal) ---
    const consigneElleve = message && message.trim()
      ? `L'élève a ajouté cette précision : "${message.trim()}". Si elle désigne une partie précise du document (ex: un chapitre, une leçon), concentre-toi uniquement dessus.`
      : "L'élève n'a pas donné de précision : résume l'ensemble du document.";

    const prompt = `Tu es un professeur particulier pour un élève de Terminale S au Sénégal (programme sénégalais).
Analyse le PDF de cours ci-joint. ${consigneElleve}

Réponds STRICTEMENT avec un objet JSON valide, sans aucun texte avant ou après, au format exact :
{
  "titre": "titre court du cours ou de la partie résumée (5 mots maximum)",
  "matiere": "une seule matière parmi : Mathématiques, Physique-Chimie, SVT, Philosophie, Français, Anglais, Histoire-Géo, Autre",
  "resume": "le résumé structuré, en français, en Markdown, avec exactement ces sections :\\n## Plan du cours\\n(les grandes parties, en liste)\\n\\n## Points clés à retenir\\n(définitions, dates, formules essentielles, en liste)\\n\\n## Résumé\\n(synthèse de 10 à 15 lignes)"
}`;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } }
              ]
            }
          ],
          generationConfig: { responseMimeType: 'application/json' }
        })
      }
    );

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      console.error('Erreur Gemini:', errText);
      return res.status(502).json({ error: "L'IA n'a pas pu analyser ce document. Réessaie." });
    }

    const geminiData = await geminiResponse.json();
    let texteJson = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!texteJson) {
      return res.status(502).json({ error: "L'IA n'a renvoyé aucun résumé pour ce document." });
    }

    texteJson = texteJson.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');

    let resultat;
    try {
      resultat = JSON.parse(texteJson);
    } catch (parseErr) {
      console.error('JSON invalide reçu de Gemini:', texteJson);
      return res.status(502).json({ error: "L'IA a renvoyé un format inattendu. Réessaie." });
    }

    const { titre, matiere, resume } = resultat;
    if (!titre || !resume) {
      return res.status(502).json({ error: "Le résumé généré est incomplet. Réessaie." });
    }

    // --- 2. Crée la conversation (type='cours') ---
    const { data: conversation, error: convError } = await supabase
      .from('resumes_cours')
      .insert({
        user_id: userId,
        type: 'cours',
        titre: titre,
        matiere: matiere || 'Autre',
        resume_texte: resume
      })
      .select()
      .single();

    if (convError || !conversation) {
      console.error('Erreur création conversation:', convError);
      return res.status(500).json({ error: "Le résumé a été généré mais la conversation n'a pas pu être créée." });
    }

    // --- 3. Enregistre le message de l'élève et la réponse de l'IA dans le fil ---
    const messageEleve = (message && message.trim()) || 'Peux-tu résumer ce cours ?';

    const { error: msgError } = await supabase
      .from('messages_prof_ia')
      .insert([
        { resume_id: conversation.id, user_id: userId, role: 'user', content: messageEleve },
        { resume_id: conversation.id, user_id: userId, role: 'ia', content: resume }
      ]);

    if (msgError) {
      console.error('Erreur enregistrement messages:', msgError);
    }

    return res.status(200).json({
      conversationId: conversation.id,
      titre: conversation.titre,
      matiere: conversation.matiere,
      resume_texte: resume
    });

  } catch (err) {
    console.error('Erreur serveur analyser-cours:', err);
    return res.status(500).json({ error: 'Erreur serveur interne' });
  }
};
