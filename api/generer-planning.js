// ============================================================
// api/generer-planning.js
// Fonction serverless Vercel — Planning de révision automatique
//
// Reçoit userId + dateExamen (YYYY-MM-DD). Récupère les cours déjà
// résumés par l'élève dans le Professeur IA (type='cours'), demande
// à Gemini un planning jour par jour, l'enregistre (en remplaçant
// un éventuel planning précédent), et le renvoie.
//
// La période couverte est bornée à 21 jours maximum avant l'examen,
// pour garder un planning pertinent et une réponse de taille raisonnable.
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
    const { userId, dateExamen } = req.body;

    if (!userId || !dateExamen) {
      return res.status(400).json({ error: 'Champs manquants : userId et dateExamen sont requis' });
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const aujourdHui = new Date();
    aujourdHui.setHours(0, 0, 0, 0);
    const dateExamenObj = new Date(dateExamen + 'T00:00:00');

    const diffJours = Math.round((dateExamenObj - aujourdHui) / (1000 * 60 * 60 * 24));
    if (diffJours <= 0) {
      return res.status(400).json({ error: "La date d'examen doit être dans le futur." });
    }

    // --- 1. Récupère les cours déjà résumés (type='cours') ---
    const { data: cours, error: coursError } = await supabase
      .from('resumes_cours')
      .select('titre, matiere')
      .eq('user_id', userId)
      .eq('type', 'cours');

    if (coursError) {
      console.error('Erreur récupération cours:', coursError);
      return res.status(500).json({ error: 'Impossible de récupérer tes cours.' });
    }

    if (!cours || cours.length === 0) {
      return res.status(400).json({ error: "Tu n'as pas encore de cours résumé dans le Professeur IA. Résume au moins un cours avant de générer un planning." });
    }

    // --- 2. Borne la période du planning à 21 jours maximum avant l'examen ---
    const joursCouverts = Math.min(diffJours, 21);
    const dateDebutBrute = new Date(dateExamenObj);
    dateDebutBrute.setDate(dateDebutBrute.getDate() - joursCouverts);
    const dateDebutEffective = dateDebutBrute > aujourdHui ? dateDebutBrute : aujourdHui;
    const dateFinPlanning = new Date(dateExamenObj.getTime() - 86400000); // veille de l'examen

    const formatISO = (d) => d.toISOString().split('T')[0];
    const listeCours = cours.map(c => `- ${c.titre} (${c.matiere})`).join('\n');

    // --- 3. Demande le planning à Gemini, en JSON strict ---
    const prompt = `Tu es un conseiller pédagogique pour un élève de Terminale S au Sénégal.
Voici les cours qu'il a déjà résumés et qu'il doit réviser :
${listeCours}

Construis un planning de révision jour par jour, du ${formatISO(dateDebutEffective)} au ${formatISO(dateFinPlanning)} inclus (l'examen a lieu le ${dateExamen}).

Règles :
- Répartis la révision de CHAQUE cours listé au moins une fois sur la période, en variant les matières d'un jour à l'autre plutôt que de les regrouper.
- Maximum 3 tâches de révision par jour.
- Le dernier jour du planning (veille de l'examen) doit être une révision légère ou du repos.
- Les tâches doivent être courtes et actionnables (ex: "Réviser le résumé de [titre] et faire les flashcards").

Réponds STRICTEMENT avec un JSON valide, sans aucun texte avant ou après, au format exact :
{"jours": [{"date": "YYYY-MM-DD", "taches": ["tâche 1", "tâche 2"]}]}`;

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
      return res.status(502).json({ error: "L'IA n'a pas pu générer le planning." });
    }

    const geminiData = await geminiResponse.json();
    let texteJson = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!texteJson) {
      return res.status(502).json({ error: "L'IA n'a renvoyé aucun planning." });
    }

    texteJson = texteJson.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');

    let planBrut;
    try {
      planBrut = JSON.parse(texteJson);
    } catch (parseErr) {
      console.error('JSON invalide reçu de Gemini:', texteJson);
      return res.status(502).json({ error: "L'IA a renvoyé un format inattendu. Réessaie." });
    }

    if (!planBrut.jours || !Array.isArray(planBrut.jours)) {
      return res.status(502).json({ error: 'Le planning généré est incomplet. Réessaie.' });
    }

    // Ajoute le statut "termine" à chaque tâche
    const plan = {
      jours: planBrut.jours.map(j => ({
        date: j.date,
        taches: (j.taches || []).map(t => ({ texte: t, termine: false }))
      }))
    };

    // --- 4. Remplace un éventuel ancien planning par le nouveau ---
    await supabase.from('plannings_revision').delete().eq('user_id', userId);

    const { data: planning, error: insertError } = await supabase
      .from('plannings_revision')
      .insert({ user_id: userId, date_examen: dateExamen, plan })
      .select()
      .single();

    if (insertError) {
      console.error('Erreur enregistrement planning:', insertError);
      return res.status(500).json({ error: "Le planning a été généré mais n'a pas pu être enregistré." });
    }

    return res.status(200).json({ planning });

  } catch (err) {
    console.error('Erreur serveur generer-planning:', err);
    return res.status(500).json({ error: 'Erreur serveur interne' });
  }
};
