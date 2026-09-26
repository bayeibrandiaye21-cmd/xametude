// ============================================================
// api/generer-flashcards.js
// Fonction serverless Vercel — Génère des flashcards de révision
// à partir d'un résumé de cours déjà analysé par le Professeur IA.
//
// Reçoit resumeId + userId (+ regenerer: true en option pour
// remplacer des flashcards déjà générées).
//
// Variables d'environnement Vercel nécessaires (déjà configurées) :
//   GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================

const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  try {
    const { resumeId, userId, regenerer } = req.body;

    if (!resumeId || !userId) {
      return res.status(400).json({ error: 'Champs manquants : resumeId et userId sont requis' });
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // --- 1. Vérifie que le résumé appartient bien à l'élève ---
    const { data: resume, error: resumeError } = await supabase
      .from('resumes_cours')
      .select('*')
      .eq('id', resumeId)
      .eq('user_id', userId)
      .single();

    if (resumeError || !resume) {
      return res.status(404).json({ error: 'Ce cours est introuvable.' });
    }

    // --- 2. Si des flashcards existent déjà et qu'on ne force pas la régénération, on les renvoie telles quelles ---
    if (!regenerer) {
      const { data: existantes } = await supabase
        .from('flashcards')
        .select('*')
        .eq('resume_id', resumeId)
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (existantes && existantes.length > 0) {
        return res.status(200).json({ flashcards: existantes });
      }
    } else {
      await supabase.from('flashcards').delete().eq('resume_id', resumeId).eq('user_id', userId);
    }

    // --- 3. Demande à Gemini de générer les flashcards en JSON strict ---
    const prompt = `Tu es un professeur particulier pour un élève de Terminale S au Sénégal.
Voici le résumé du cours "${resume.titre}" (matière : ${resume.matiere}) :

${resume.resume_texte}

Génère entre 8 et 10 flashcards de révision à partir de ce résumé : des questions courtes et précises, avec une réponse concise (une phrase ou deux maximum).
Réponds STRICTEMENT avec un tableau JSON valide, sans aucun texte avant ou après, au format exact :
[{"question": "...", "reponse": "..."}]`;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      }
    );

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      console.error('Erreur Gemini:', errText);
      return res.status(502).json({ error: "L'IA n'a pas pu générer les flashcards." });
    }

    const geminiData = await geminiResponse.json();
    let texteJson = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!texteJson) {
      return res.status(502).json({ error: "L'IA n'a renvoyé aucune flashcard." });
    }

    // Sécurité : enlève d'éventuelles balises markdown si le modèle en ajoute quand même
    texteJson = texteJson.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');

    let cartes;
    try {
      cartes = JSON.parse(texteJson);
    } catch (parseErr) {
      console.error('JSON invalide reçu de Gemini:', texteJson);
      return res.status(502).json({ error: "L'IA a renvoyé un format inattendu. Réessaie." });
    }

    if (!Array.isArray(cartes) || cartes.length === 0) {
      return res.status(502).json({ error: "Aucune flashcard valide n'a été générée." });
    }

    // --- 4. Sauvegarde les flashcards ---
    const lignesAInserer = cartes
      .filter(c => c.question && c.reponse)
      .map(c => ({
        resume_id: resumeId,
        user_id: userId,
        question: c.question,
        reponse: c.reponse
      }));

    const { data: inserees, error: insertError } = await supabase
      .from('flashcards')
      .insert(lignesAInserer)
      .select();

    if (insertError) {
      console.error('Erreur sauvegarde flashcards:', insertError);
      return res.status(500).json({ error: "Les flashcards ont été générées mais n'ont pas pu être enregistrées." });
    }

    return res.status(200).json({ flashcards: inserees });

  } catch (err) {
    console.error('Erreur serveur generer-flashcards:', err);
    return res.status(500).json({ error: 'Erreur serveur interne' });
  }
};
