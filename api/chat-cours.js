// ============================================================
// api/chat-cours.js
// Fonction serverless Vercel — Chat avec le Professeur IA sur un cours précis
//
// Reçoit resumeId + question + userId. Récupère le résumé du cours
// (qui sert de contexte, pas besoin de renvoyer le PDF) ainsi que
// l'historique de la conversation, interroge Gemini, sauvegarde la
// question et la réponse, puis renvoie la réponse.
//
// Variables d'environnement Vercel nécessaires (déjà configurées) :
//   GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const MAX_HISTORIQUE = 20; // limite le nombre de messages renvoyés à Gemini (coût/taille)

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  try {
    const { resumeId, question, userId } = req.body;

    if (!resumeId || !question || !userId) {
      return res.status(400).json({
        error: 'Champs manquants : resumeId, question et userId sont requis'
      });
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // --- 1. Récupère le résumé du cours (sert de contexte à l'IA) ---
    const { data: resume, error: resumeError } = await supabase
      .from('resumes_cours')
      .select('*')
      .eq('id', resumeId)
      .eq('user_id', userId)
      .single();

    if (resumeError || !resume) {
      return res.status(404).json({ error: 'Ce cours est introuvable.' });
    }

    // --- 2. Récupère l'historique de la conversation sur ce cours ---
    const { data: historiqueComplet, error: histError } = await supabase
      .from('messages_prof_ia')
      .select('role, content')
      .eq('resume_id', resumeId)
      .order('created_at', { ascending: true });

    if (histError) {
      console.error('Erreur récupération historique:', histError);
    }

    const historique = (historiqueComplet || []).slice(-MAX_HISTORIQUE);

    // --- 3. Construit le contexte pour Gemini ---
    const contexteSysteme = `Tu es un professeur particulier pour un élève de Terminale S au Sénégal (programme sénégalais).
Voici le résumé du cours "${resume.titre}" (matière : ${resume.matiere}) sur lequel l'élève va te poser des questions :

${resume.resume_texte}

Réponds aux questions de l'élève en t'appuyant sur ce cours, de façon claire, pédagogique et concise, en français. Si une question dépasse le cadre de ce cours précis, tu peux quand même l'aider mais précise-le.`;

    const contents = [
      { role: 'user', parts: [{ text: contexteSysteme }] },
      { role: 'model', parts: [{ text: "Compris, je suis prêt à répondre aux questions de l'élève sur ce cours." }] }
    ];

    historique.forEach(msg => {
      contents.push({
        role: msg.role === 'ia' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      });
    });

    contents.push({ role: 'user', parts: [{ text: question }] });

    // --- 4. Appel à Gemini ---
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents })
      }
    );

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      console.error('Erreur Gemini:', errText);
      return res.status(502).json({ error: "L'IA n'a pas pu répondre pour le moment." });
    }

    const geminiData = await geminiResponse.json();
    const reponseTexte = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!reponseTexte) {
      return res.status(502).json({ error: "L'IA n'a renvoyé aucune réponse." });
    }

    // --- 5. Sauvegarde la question et la réponse (best-effort) ---
    const { error: insertError } = await supabase
      .from('messages_prof_ia')
      .insert([
        { resume_id: resumeId, user_id: userId, role: 'user', content: question },
        { resume_id: resumeId, user_id: userId, role: 'ia', content: reponseTexte }
      ]);

    if (insertError) {
      console.error('Erreur sauvegarde messages:', insertError);
    }

    return res.status(200).json({ reponse: reponseTexte });

  } catch (err) {
    console.error('Erreur serveur chat-cours:', err);
    return res.status(500).json({ error: 'Erreur serveur interne' });
  }
};
