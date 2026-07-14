const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');
const multer = require('multer'); // Importez multer
require('dotenv').config();

const app = express();
const PORT = 10002;

// Configuration de multer : enregistre les images dans le dossier 'uploads'
const upload = multer({ dest: 'uploads/' });

// Initialisation du pool de connexion MySQL
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306
});

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Important pour parser les données de formulaire
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static('uploads')); // Permet d'accéder aux images via /uploads/nom_fichier

// Route principale
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'catalogue.html'));
});

// Route pour ajouter un produit (avec gestion des fichiers)
app.post('/api/ajouter-produit', upload.fields([
    { name: 'image1', maxCount: 1 },
    { name: 'image2', maxCount: 1 },
    { name: 'image3', maxCount: 1 }
]), async (req, res) => {
    try {
        const { nom, categorie, prix, description, stock } = req.body;
        
        // Récupération des chemins des fichiers si téléchargés
        const img1 = req.files['image1'] ? req.files['image1'][0].path : null;
        const img2 = req.files['image2'] ? req.files['image2'][0].path : null;
        const img3 = req.files['image3'] ? req.files['image3'][0].path : null;

        // Exemple d'insertion dans votre DB (ajustez selon votre table)
        await db.execute(
            'INSERT INTO produits (nom, categorie, prix, description, stock, image, image2, image3) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [nom, categorie, prix, description, stock, img1, img2, img3]
        );

        res.json({ message: "Produit ajouté avec succès !" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erreur lors de l'ajout." });
    }
});

app.listen(PORT, () => {
    console.log(`Boutique Lean démarrée sur http://localhost:${PORT}`);
});


// Route API pour l'inscription avec MySQL
app.post('/api/inscription', async (req, res) => {
    const { nom, email, id, password } = req.body;
    const role = 'client'; // Rôle défini manuellement

    try {
        // 1. Vérification si l'utilisateur existe déjà
        const [rows] = await db.query('SELECT id FROM utilisateurs_leanpay WHERE id = ?', [id]);

        if (rows.length > 0) {
            return res.status(400).json({ message: "Ce numéro est déjà utilisé." });
        }

        // 2. Insertion avec les 5 colonnes
        // Assurez-vous que l'ordre ici correspond exactement à l'ordre dans votre base (DESCRIBE l'a confirmé)
        const sql = 'INSERT INTO utilisateurs_leanpay (id, nom, email, password, role) VALUES (?, ?, ?, ?, ?)';
        await db.query(sql, [id, nom, email, password, role]);

        res.status(201).json({ message: "Inscription réussie ! Connectez-vous." });
    } catch (err) {
        console.error("Erreur inscription :", err);
        res.status(500).json({ message: "Erreur serveur." });
    }
});

app.post('/api/connexion', async (req, res) => {
    const { id, password } = req.body;

    try {
        const [rows] = await db.query('SELECT * FROM utilisateurs_leanpay WHERE id = ?', [id]);

        if (rows.length === 0 || rows[0].password !== password) {
            return res.status(401).json({ message: "Identifiants invalides." });
        }

        // On ajoute l'URL de redirection dans la réponse JSON
        res.status(200).json({
            message: "Connexion réussie !",
            nom: rows[0].nom,
            role: rows[0].role,
            redirectUrl: '/catalogue.html' // L'URL de destination
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erreur serveur." });
    }
});


// Middleware de vérification d'admin
function verifierAdmin(req, res, next) {
    const userRole = req.headers['x-user-role'];
    if (userRole === 'admin') {
        next();
    } else {
        res.status(403).json({ message: "Accès refusé : vous n'êtes pas administrateur." });
    }
}

// Exemple de route protégée pour supprimer un produit
app.post('/api/supprimer-produit', verifierAdmin, async (req, res) => {
    const { idProduit } = req.body;
    try {
        await db.query('DELETE FROM produits WHERE id = ?', [idProduit]);
        res.status(200).json({ message: "Produit supprimé avec succès." });
    } catch (err) {
        res.status(500).json({ message: "Erreur lors de la suppression." });
    }
});

// Route pour récupérer tous les utilisateurs
app.get('/api/utilisateurs', verifierAdmin, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT id, nom, email, password, role FROM utilisateurs_leanpay');
        res.status(200).json(rows);
    } catch (err) {
        res.status(500).json({ message: "Erreur lors de la récupération des utilisateurs." });
    }
});

// Route pour récupérer toutes les commandes (CORRIGÉE : ajout de 'statut')
app.get('/api/commandes', async (req, res) => {
    try {
        // ASSUREZ-VOUS QUE TOUTES CES COLONNES SONT PRÉSENTES DANS LE SELECT
        const [commandes] = await db.query(
            "SELECT id_commande, id_client, nom_article, prix, adresse, telephone, date_commande, statut FROM commandes"
        );
        res.json(commandes);
    } catch (err) {
        res.status(500).json({ error: "Erreur lors de la récupération des commandes" });
    }
});


app.post('/api/update-statut', verifierAdmin, async (req, res) => {
    const { id_commande } = req.body;
    try {
        await db.query('UPDATE commandes SET statut = "paye" WHERE id_commande = ?', [id_commande]);
        res.status(200).json({ message: "Statut mis à jour." });
    } catch (err) {
        res.status(500).json({ message: "Erreur serveur." });
    }
});


app.post('/api/ajouter-commande', async (req, res) => {
    const { id_client, nom_article, prix, adresse, telephone } = req.body;

    // --- LOGIQUE UNIFIÉE ---
    const timestamp = Date.now().toString();
    const idChiffres = timestamp.slice(-6); 
    const maintenant = new Date();
    const heure = maintenant.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); // Format HH:MM
    
    const numeroCommande = `C${idChiffres}${heure.replace(':', '')}`; 
    const dateCommande = maintenant.toLocaleDateString('fr-FR');
    
    // On crée une chaîne combinée : "13/07/2026 à 16:45"
    const dateEtHeure = `${dateCommande} à ${heure}`;
    // -----------------------

    try {
        // 1. Insertion Commande
        await db.query("INSERT INTO commandes (id_commande, id_client, nom_article, prix, adresse, telephone, date_commande) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [numeroCommande, id_client, nom_article, prix, adresse, telephone, dateCommande]);

        // 2. Insertion Message (on utilise 'dateEtHeure' pour afficher la date et l'heure dans la boîte)
        const messageContenu = `Votre commande ${numeroCommande} du ${dateEtHeure} pour ${nom_article} (Total: ${prix} XOF) a été confirmée. Merci de votre confiance !`;
        
        await db.query("INSERT INTO messages (id_client, sujet, contenu, date_envoi) VALUES (?, ?, ?, ?)",
            [id_client, "Confirmation de commande " + numeroCommande, messageContenu, dateEtHeure]);

        res.status(200).json({ message: "Succès : Commande enregistrée !" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erreur serveur." });
    }
});



app.get('/api/messages', async (req, res) => {
    const id_client = req.query.id_client;

    // Log pour le débogage (indispensable pour savoir ce qu'il se passe)
    console.log("Recherche des messages pour l'ID Client :", id_client);

    if (!id_client || id_client === 'null' || id_client === 'undefined') {
        return res.json([]);
    }

    try {
        // La requête est correcte
        const sql = "SELECT * FROM messages WHERE id_client = ? ORDER BY id DESC";
        const [rows] = await db.query(sql, [id_client.trim()]); // .trim() enlève les espaces inutiles

        console.log("Nombre de messages trouvés :", rows.length);
        res.json(rows);
    } catch (err) {
        console.error("Erreur API messages :", err);
        res.status(500).json({ message: "Erreur serveur" });
    }
});


app.post('/api/ajouter-produit', async (req, res) => {
    // Récupération de tous les champs envoyés par le formulaire
    const { nom, categorie, prix, description, stock, image } = req.body;

    try {
        // La requête SQL doit inclure les 6 colonnes pour correspondre à votre table
        const sql = 'INSERT INTO produits (nom, categorie, prix, description, stock, image) VALUES (?, ?, ?, ?, ?, ?)';
        
        await db.query(sql, [nom, categorie, prix, description, stock, image]);

        res.status(201).json({ message: "Produit ajouté avec succès !" });
    } catch (err) {
        console.error("Erreur serveur lors de l'ajout :", err);
        res.status(500).json({ message: "Erreur lors de l'ajout." });
    }
});


app.get('/api/produits', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM produits');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Erreur lors de la récupération." });
    }
});


app.delete('/api/supprimer-produit/:id', async (req, res) => {
    const { id } = req.params;
    await db.execute('DELETE FROM produits WHERE id = ?', [id]);
    res.json({ message: "Produit supprimé" });
});

// Et ajouter cette route pour afficher la liste :
app.get('/api/produits', async (req, res) => {
    const [rows] = await db.execute('SELECT id, nom, prix FROM produits');
    res.json(rows);
});

