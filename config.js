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

// ============================================
// TRADUCTION DES ERREURS SUPABASE EN MESSAGES CLAIRS (FR)
// ============================================
function traduireErreur(error) {
    if (!error) return "Une erreur inconnue est survenue.";
    const msg = (error.message || "").toLowerCase();

    if (msg.includes("invalid login credentials")) return "Email ou mot de passe incorrect.";
    if (msg.includes("user already registered")) return "Un compte existe déjà avec cet email. Essaie de te connecter.";
    if (msg.includes("password should be at least")) return "Le mot de passe doit contenir au moins 6 caractères.";
    if (msg.includes("unable to validate email")) return "Cette adresse email n'est pas valide.";
    if (msg.includes("email not confirmed")) return "Ce compte n'a pas encore été confirmé.";
    if (msg.includes("network") || msg.includes("fetch")) return "Problème de connexion internet. Vérifie ta connexion et réessaie.";
    if (msg.includes("row-level security") || msg.includes("permission denied")) return "Tu n'as pas la permission de faire cette action.";
    if (msg.includes("duplicate key")) return "Cet élément existe déjà.";

    return "Une erreur est survenue : " + error.message;
}

// ============================================
// NOTIFICATIONS VISUELLES (remplace les alert() basiques)
// Utilisation : afficherToast("Message", "success" | "error" | "info")
// ============================================
function afficherToast(message, type = "info") {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = 'position:fixed; top:16px; left:50%; transform:translateX(-50%); z-index:9999; display:flex; flex-direction:column; gap:8px; width:calc(100% - 32px); max-width:380px; pointer-events:none;';
        document.body.appendChild(container);
    }

    const styles = {
        success: { bg: '#ecfdf5', border: '#a7f3d0', text: '#047857', icon: 'check-circle' },
        error: { bg: '#fef2f2', border: '#fecaca', text: '#dc2626', icon: 'alert-circle' },
        info: { bg: '#eef2ff', border: '#c7d2fe', text: '#4338ca', icon: 'info' }
    };
    const s = styles[type] || styles.info;

    const toast = document.createElement('div');
    toast.style.cssText = `background:${s.bg}; border:1px solid ${s.border}; color:${s.text}; padding:12px 16px; border-radius:14px; font-size:12.5px; font-weight:600; box-shadow:0 8px 20px rgba(0,0,0,0.08); display:flex; align-items:center; gap:8px; opacity:0; transform:translateY(-12px); transition:all 0.25s ease; pointer-events:auto;`;
    toast.innerHTML = `<i data-lucide="${s.icon}" style="width:16px;height:16px;flex:none;"></i><span>${message}</span>`;
    container.appendChild(toast);

    if (window.lucide) lucide.createIcons();

    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-12px)';
        setTimeout(() => toast.remove(), 250);
    }, 4000);
}
