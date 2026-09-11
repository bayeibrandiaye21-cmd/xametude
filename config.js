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
// CLOCHE DE NOTIFICATIONS (réutilisable sur toutes les pages)
// Utilisation : initNotifBell('id-du-conteneur', currentUser.id)
// ============================================
function initNotifBell(containerId, currentUserId) {
    const container = document.getElementById(containerId);
    if (!container || !currentUserId) return;

    container.innerHTML = `
      <div class="relative">
        <button id="notif-bell-btn" type="button" class="relative p-2 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition">
            <i data-lucide="bell" class="h-5 w-5"></i>
            <span id="notif-badge" class="hidden absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full h-4 w-4 flex items-center justify-center">0</span>
        </button>
        <div id="notif-panel" class="hidden absolute right-0 mt-2 w-72 bg-white rounded-xl border border-slate-200 shadow-xl z-50 overflow-hidden">
            <div class="p-3 border-b border-slate-100 flex items-center justify-between">
                <span class="text-xs font-bold text-slate-700">Notifications</span>
                <button id="notif-mark-all" type="button" class="text-[10px] font-semibold text-indigo-600 hover:underline">Tout marquer comme lu</button>
            </div>
            <div id="notif-list" class="max-h-80 overflow-y-auto divide-y divide-slate-50">
                <div class="p-4 text-center text-xs text-slate-400">Chargement...</div>
            </div>
        </div>
      </div>
    `;
    if (window.lucide) lucide.createIcons();

    const btn = document.getElementById('notif-bell-btn');
    const panel = document.getElementById('notif-panel');

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) panel.classList.add('hidden');
    });

    async function chargerNotifs() {
        const { data: notifs, error } = await window.supabaseClient
            .from('notifications')
            .select('*')
            .eq('user_id', currentUserId)
            .order('created_at', { ascending: false })
            .limit(15);

        if (error || !notifs) return;

        const unread = notifs.filter(n => !n.is_read).length;
        const badge = document.getElementById('notif-badge');
        if (unread > 0) {
            badge.textContent = unread > 9 ? '9+' : unread;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }

        const list = document.getElementById('notif-list');
        if (notifs.length === 0) {
            list.innerHTML = '<div class="p-4 text-center text-xs text-slate-400">Aucune notification pour le moment.</div>';
            return;
        }

        list.innerHTML = notifs.map(n => `
            <a href="${n.link || '#'}" data-id="${n.id}" class="notif-item block p-3 hover:bg-slate-50 transition ${n.is_read ? '' : 'bg-indigo-50/50'}">
                <div class="text-xs text-slate-700 ${n.is_read ? '' : 'font-semibold'}">${n.message}</div>
                <div class="text-[10px] text-slate-400 mt-1">${new Date(n.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
            </a>
        `).join('');

        list.querySelectorAll('.notif-item').forEach(item => {
            item.addEventListener('click', async () => {
                await window.supabaseClient.from('notifications').update({ is_read: true }).eq('id', item.dataset.id);
            });
        });
    }

    document.getElementById('notif-mark-all').addEventListener('click', async (e) => {
        e.stopPropagation();
        await window.supabaseClient.from('notifications').update({ is_read: true }).eq('user_id', currentUserId).eq('is_read', false);
        await chargerNotifs();
    });

    chargerNotifs();

    // Temps réel : nouvelle notification reçue
    window.supabaseClient
        .channel('notifs-' + currentUserId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentUserId}` }, () => {
            chargerNotifs();
            if (window.afficherToast) afficherToast('Nouvelle notification !', 'info');
        })
        .subscribe();
}
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
