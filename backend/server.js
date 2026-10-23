
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));

// Supabase connection
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase settings in backend/.env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
// Verify the logged-in user's Supabase access token
async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;

    if (!token) {
        return res.status(401).json({
            error: "Please log in first."
        });
    }

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
        return res.status(401).json({
            error: "Invalid or expired login session."
        });
    }

const userSupabase = createClient(
    supabaseUrl,
    supabaseKey,
    {
        global: {
            headers: {
                Authorization: `Bearer ${token}`
            }
        }
    }
);

req.supabase = userSupabase;
req.user = data.user;
req.accessToken = token;
next();

}

// Home route
app.get("/", (req, res) => {
    res.send("CampusConnect Backend is Running!");
});

// GET: Fetch reports from Supabase
app.get("/api/items", async (req, res) => {
    const { data, error } = await supabase
        .from("items")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) {
        console.error("Fetch error:", error.message);
        return res.status(500).json({
            error: "Could not fetch reports"
        });
    }

    const items = data.map(row => ({
        id: row.id,
        type: row.type,
        title: row.title,
        category: row.category,
        color: row.color,
        loc: row.loc,
        date: row.date,
        desc: row.description,
        secret: row.secret,
        img: row.img,
        status: row.status,
        who: row.who
    }));

    res.json(items);
});

// POST: Create a report, preventing duplicate submissions
("/api/items", requireAuth, async (req, res) => {
    const body = req.body;

    const title = body.title || body.name;
    const loc = body.loc || body.location;
    const requestId = body.request_id;

    if (
        typeof title !== "string" ||
        !title.trim() ||
        typeof loc !== "string" ||
        !loc.trim() ||
        !["lost", "found"].includes(body.type) ||
        typeof requestId !== "string" ||
        !requestId.trim()
    ) {
        return res.status(400).json({
            error: "Title, location, type, and request_id are required."
        });
    }

    // Return the existing report if this request was already processed
    const { data: existing, error: lookupError } = await supabase
        .from("items")
        .select("*")
        .eq("request_id", requestId)
        .maybeSingle();

    if (lookupError) {
        console.error("Duplicate check error:", lookupError.message);
        return res.status(500).json({
            error: "Could not check existing report."
        });
    }

    if (existing) {
        return res.status(200).json({
            message: "This report was already submitted.",
            item: { ...existing, desc: existing.description }
        });
    }

    const newItem = {
        id: `server-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        request_id: requestId,
        owner_id: req.user.id,
        type: body.type,
        title: title.trim(),
        category: body.category || "Other",
        color: body.color || "",
        loc: loc.trim(),
        date: body.date || new Date().toISOString().slice(0, 10),
        description: body.desc || body.description || "",
        secret: body.secret || "",
        img: body.img || "",
        status: body.status || "open",
        who: body.who || "Student"
    };

    const { data, error } = await req.supabase
        .from("items")
        .insert(newItem)
        .select()
        .single();

    if (error) {
        // Handle a concurrent retry of the same request
        if (error.code === "23505") {
            const { data: saved, error: retryError } = await req.supabase
                .from("items")
                .select("*")
                .eq("request_id", requestId)
                .maybeSingle();

            if (!retryError && saved) {
                return res.status(200).json({
                    message: "This report was already submitted.",
                    item: { ...saved, desc: saved.description }
                });
            }
        }

        console.error("Insert error:", error.message);
        return res.status(500).json({
            error: "Could not save report."
        });
    }

    res.status(201).json({
        message: "Report saved successfully!",
        item: { ...data, desc: data.description }
    });
});

// Start server
const PORT = 3000;

app.listen(PORT, () => {
    console.log(`CampusConnect server running at http://localhost:${PORT}`);
});
