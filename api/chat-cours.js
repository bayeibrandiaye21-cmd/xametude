// ============================================================
// api/chat-cours.js
// Fonction serverless Vercel — Chat avec le Professeur IA
//
// Reçoit conversationId (peut être null/absent pour démarrer une
// nouvelle discussion libre) + question + userId.
//
// Si conversationId est fourni : récupère la conversation (avec ou
// sans résumé de cours associé) et l'historique, pour garder le
// contexte. Si conversationId est absent : crée une nouvelle
// conversation de type 'discussion' (sans PDF ni résumé).
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
    const { conversationId, question, userId } = req.body;

    if (!question || !userId) {
      return res.status(400).json({ error: 'Champs manquants : question et userId sont requis' });
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let conversation;

    // --- 1. Récupère la conversation existante, ou en crée une nouvelle (discussion libre) ---
    if (conversationId) {
      const { data, error } = await supabase
        .from('resumes_cours')
        .select('*')
        .eq('id', conversationId)
        .eq('user_id', userId)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: 'Cette conversation est introuvable.' });
      }
      conversation = data;
    } else {
      const titreAuto = question.length > 50 ? question.slice(0, 50) + '…' : question;
      const { data, error } = await supabase
        .from('resumes_cours')
        .insert({ user_id: userId, type: 'discussion', titre: titreAuto })
        .select()
        .single();

      if (error || !data) {
        console.error('Erreur création discussion:', error);
        return res.status(500).json({ error: "Impossible de démarrer une nouvelle discussion." });
      }
      conversation = data;
    }

    // --- 2. Récupère l'historique de la conversation ---
    const { data: historiqueComplet, error: histError } = await supabase
      .from('messages_prof_ia')
      .select('role, content')
      .eq('resume_id', conversation.id)
      .order('created_at', { ascending: true });

    if (histError) {
      console.error('Erreur récupération historique:', histError);
    }

    const historique = (historiqueComplet || []).slice(-MAX_HISTORIQUE);

    // --- 3. Construit le contexte pour Gemini ---
    const contexteSysteme = conversation.resume_texte
      ? `Tu es un professeur particulier pour un élève de Terminale S au Sénégal (programme sénégalais).
Voici le résumé du cours "${conversation.titre}" (matière : ${conversation.matiere}) sur lequel l'élève va te poser des questions :

${conversation.resume_texte}

Réponds aux questions de l'élève en t'appuyant sur ce cours, de façon claire, pédagogique et concise, en français. Si une question dépasse le cadre de ce cours précis, tu peux quand même l'aider mais précise-le.`
      : `Tu es un professeur particulier et un accompagnateur scolaire pour un élève de Terminale S au Sénégal (programme sénégalais).
Cette conversation n'est liée à aucun cours précis : réponds à ses questions de façon claire, pédagogique et bienveillante, en français.`;

    const contents = [
      { role: 'user', parts: [{ text: contexteSysteme }] },
      { role: 'model', parts: [{ text: "Compris, je suis prêt à répondre à l'élève." }] }
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

    // --- 5. Sauvegarde la question et la réponse, met à jour la date d'activité ---
    const { error: insertError } = await supabase
      .from('messages_prof_ia')
      .insert([
        { resume_id: conversation.id, user_id: userId, role: 'user', content: question },
        { resume_id: conversation.id, user_id: userId, role: 'ia', content: reponseTexte }
      ]);

    if (insertError) {
      console.error('Erreur sauvegarde messages:', insertError);
    }

    await supabase
      .from('resumes_cours')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversation.id);

    return res.status(200).json({
      conversationId: conversation.id,
      titre: conversation.titre,
      reponse: reponseTexte
    });

  } catch (err) {
    console.error('Erreur serveur chat-cours:', err);
    return res.status(500).json({ error: 'Erreur serveur interne' });
  }
};
