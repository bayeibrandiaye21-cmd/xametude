// ============================================================
// api/analyser-cours.js
// Fonction serverless Vercel — "Professeur IA" de XamÉtudes
//
// Reçoit un PDF de cours (en base64) + matière/titre/userId,
// l'envoie à Gemini pour analyse (Gemini lit le PDF directement,
// pas besoin d'extraire le texte côté serveur), puis enregistre
// le résumé généré dans la table Supabase "resumes_cours".
//
// Variables d'environnement Vercel nécessaires (déjà configurées
// pour api/ask-ia.js) :
//   GEMINI_API_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// LIMITE IMPORTANTE : le plan Vercel Hobby limite le corps d'une
// requête serverless à 4,5 Mo. Le PDF encodé en base64 grossit
// d'environ 33 %, donc garde les PDF sous ~3 Mo côté élève.
// ============================================================

const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  try {
    const { pdfBase64, titre, matiere, userId } = req.body;

    if (!pdfBase64 || !titre || !matiere || !userId) {
      return res.status(400).json({
        error: 'Champs manquants : pdfBase64, titre, matiere et userId sont requis'
      });
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // --- 1. Appel à Gemini avec le PDF en pièce jointe (multimodal) ---
    const prompt = `Tu es un professeur particulier pour un élève de Terminale S au Sénégal (programme sénégalais).
Le PDF ci-joint (matière : ${matiere}) peut contenir un chapitre entier avec plusieurs leçons, ou un seul sujet précis.

L'élève souhaite un résumé centré sur : "${titre}"

Consignes :
- Si le PDF contient plusieurs leçons ou parties, repère et utilise UNIQUEMENT la ou les sections qui correspondent à "${titre}". Ignore le reste du document.
- Si "${titre}" ne correspond à aucune section identifiable du PDF, résume alors le document dans son ensemble et précise-le en une phrase au tout début de ta réponse.
- Ne résume jamais un sujet plus large que ce qui a été demandé simplement parce qu'il est présent dans le même PDF.

Produis un résumé structuré, clair et pédagogique, en français, avec exactement ces sections :

## Plan du cours
(les grandes parties du sujet demandé, en liste)

## Points clés à retenir
(définitions, dates, formules, théorèmes essentiels au sujet demandé, en liste)

## Résumé
(une synthèse de 10 à 15 lignes qui reformule l'essentiel du sujet demandé avec tes propres mots)

Réponds uniquement avec ce résumé structuré (et l'éventuelle précision mentionnée ci-dessus), sans autre phrase d'introduction ni de conclusion.`;

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
                {
                  inline_data: {
                    mime_type: 'application/pdf',
                    data: pdfBase64
                  }
                }
              ]
            }
          ]
        })
      }
    );

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      console.error('Erreur Gemini:', errText);
      return res.status(502).json({ error: "L'IA n'a pas pu analyser ce document. Réessaie." });
    }

    const geminiData = await geminiResponse.json();
    const resumeTexte = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!resumeTexte) {
      return res.status(502).json({ error: "L'IA n'a renvoyé aucun résumé pour ce document." });
    }

    // --- 2. Sauvegarde du résumé dans Supabase ---
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data, error } = await supabase
      .from('resumes_cours')
      .insert({
        user_id: userId,
        titre: titre,
        matiere: matiere,
        resume_texte: resumeTexte
      })
      .select()
      .single();

    if (error) {
      console.error('Erreur Supabase:', error);
      return res.status(500).json({ error: "Le résumé a été généré mais n'a pas pu être enregistré." });
    }

    return res.status(200).json({ resume: data });

  } catch (err) {
    console.error('Erreur serveur analyser-cours:', err);
    return res.status(500).json({ error: 'Erreur serveur interne' });
  }
};
