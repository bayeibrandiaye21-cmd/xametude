// ============================================
// CONFIGURATION SUPABASE - XamÉtudes
// Ce fichier est utilisé par toutes les pages du site
// ============================================

const SUPABASE_URL = "https://qlkheoquvvaktgggsrbq.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsa2hlb3F1dnZha3RnZ2dzcmJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwNTAwMDQsImV4cCI6MjEwNDYyNjAwNH0.S6nvCcGS4KriIpnrsy5Cj4bb4vCMG7UpRfW_B3ZyYqY";

// Création du client Supabase (disponible partout via window.supabaseClient)
const { createClient } = supabase;
window.supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================
// FONCTION UTILE : vérifier si l'élève est connecté
// Redirige vers connexion.html si ce n'est pas le cas
// À appeler en haut de chaque page protégée
// ============================================
async function verifierConnexion() {
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) {
        window.location.href = "connexion.html";
        return null;
    }
    return session.user;
}

// ============================================
// FONCTION UTILE : récupérer le profil complet de l'élève connecté
// ============================================
async function getProfilActuel() {
    const user = await verifierConnexion();
    if (!user) return null;

    const { data: profile, error } = await window.supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

    if (error) {
        console.error("Erreur récupération profil :", error);
        return null;
    }
    return profile;
}

// ============================================
// FONCTION UTILE : déconnexion
// ============================================
async function seDeconnecter() {
    await window.supabaseClient.auth.signOut();
    window.location.href = "connexion.html";
}
