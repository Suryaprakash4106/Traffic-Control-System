// -------------------- Load environment --------------------
require("dotenv").config({
  path: require("path").join(__dirname, ".env"),
  override: true
});

// -------------------- Required modules --------------------
const mongoose = require("mongoose");
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const { exec } = require("child_process");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");

// 🔹 OAuth
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const GitHubStrategy = require("passport-github2").Strategy;

// CORS
const cors = require('cors');

const saltRounds = 10;
const app = express();

// ==================== CORS CONFIGURATION (FIXED) ====================
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'X-Requested-With', 'Accept'],
    credentials: true
}));

// Handle preflight requests explicitly
app.options('*', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Origin, X-Requested-With, Accept');
    res.sendStatus(200);
});

// Additional CORS headers middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || "opsmind_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// Static files
app.use(express.static(path.join(__dirname, "../frontend")));

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

app.get("/", (req, res) => {
    res.send("Backend Working - Traffic System API");
});

// Test endpoint for debugging
app.post("/test-email", async (req, res) => {
    console.log("Test endpoint hit!");
    res.json({ message: "Backend is working!" });
});

const PORT = process.env.PORT || 3000;

// -------------------- MongoDB connection --------------------
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGOURI);
    console.log("✅ MongoDB Atlas connected");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
  }
}
connectDB();

// -------------------- Upload folder --------------------
const uploadFolder = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadFolder)) fs.mkdirSync(uploadFolder);

// -------------------- Multer --------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadFolder),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const upload = multer({ storage });

// -------------------- OTP STORE --------------------
const otpStore = {};

// -------------------- MongoDB Schemas --------------------
const pdfSchema = new mongoose.Schema({
  fileName: String,
  pages: Number,
  pdfPreview: String,
  uploadDate: { type: Date, default: Date.now }
});
const PdfModel = mongoose.model("Pdf", pdfSchema);

const pdfVectorSchema = new mongoose.Schema({
  fileName: String,
  chunkIndex: Number,
  textChunk: String,
  embedding: [Number],
  uploadDate: { type: Date, default: Date.now }
});
const PdfVector = mongoose.model("PdfVector", pdfVectorSchema);

// User Schema
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  mobile: { type: String },
  password: { type: String, required: true },
  role: { type: String, enum: ["admin", "user", "police", "operator"], default: "user" },
  status: { type: String, enum: ["active", "blocked"], default: "active" },
  lastLogin: { type: Date },
  lastLogout: { type: Date },
  loginHistory: [{
    time: { type: Date, default: Date.now },
    action: { type: String, enum: ['Login', 'Logout'] },
    ip: String,
    device: String
  }],
  isVerified: { type: Boolean, default: true },
  otp: Number,
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model("User", userSchema);

// Traffic Records Schema
const trafficRecordSchema = new mongoose.Schema({
  recordId: { type: String, unique: true },
  dateTime: { type: Date, default: Date.now },
  vehicleType: { type: String, default: 'Car' },
  area: String,
  status: String,
  field1: Number,
  field2: Number,
  field3: Number,
  field4: Number,
  field5: Number,
  field6: Number,
  createdAt: { type: Date, default: Date.now }
});
const TrafficRecord = mongoose.model("TrafficRecord", trafficRecordSchema);

// ==================== NODEMAILER WITH BREVO ====================
const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.BREVO_EMAIL,
    pass: process.env.BREVO_API_KEY
  },
  tls: {
    rejectUnauthorized: false
  }
});

// Verify SMTP connection on startup
transporter.verify((error, success) => {
  if (error) {
    console.error("❌ SMTP Connection Error:", error);
  } else {
    console.log("✅ SMTP Ready to send emails");
  }
});

// ==================== MOBILE OTP ====================
app.post("/send-mobile-otp", (req, res) => {
  const { mobile } = req.body;

  if (!mobile) return res.status(400).json({ error: "Mobile required" });

  const otp = Math.floor(100000 + Math.random() * 900000);
  otpStore[`mobile_${mobile}`] = {
    otp: otp,
    expires: Date.now() + 300000
  };

  console.log("\n =====================");
  console.log(`📱 Mobile: ${mobile}`);
  console.log(`🔑 OTP: ${otp}`);
  console.log(`⏰ Expires: ${new Date(Date.now() + 300000).toLocaleTimeString()}`);
  console.log("=====================\n");

  res.json({ message: "OTP sent to mobile" });
});

app.post("/verify-mobile-otp", (req, res) => {
  const { mobile, otp } = req.body;

  const key = `mobile_${mobile}`;
  const stored = otpStore[key];

  if (!stored) {
    return res.status(400).json({ error: "No OTP found. Request new OTP." });
  }

  if (Date.now() > stored.expires) {
    delete otpStore[key];
    return res.status(400).json({ error: "OTP expired" });
  }

  if (stored.otp != otp) {
    return res.status(400).json({ error: "Invalid OTP" });
  }

  delete otpStore[key];
  res.json({ message: "Mobile verified successfully" });
});

// ==================== EMAIL OTP ====================
app.post("/send-email-otp", async (req, res) => {
  const { email } = req.body;

  if (!email) return res.status(400).json({ error: "Email required" });

  const otp = Math.floor(100000 + Math.random() * 900000);
  otpStore[`email_${email}`] = {
    otp: otp,
    expires: Date.now() + 300000
  };

  try {
    await transporter.sendMail({
      from: `"Traffic Control System" <${process.env.BREVO_EMAIL}>`,
      to: email,
      subject: "Email Verification OTP",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #0066cc;">🚦 Traffic Control System</h2>
          <p>Your OTP for verification is:</p>
          <h1 style="color: #1563c8; font-size: 36px; letter-spacing: 5px;">${otp}</h1>
          <p>This OTP will expire in <strong>5 minutes</strong>.</p>
          <p>If you didn't request this, please ignore this email.</p>
          <hr>
          <p style="color: #666; font-size: 12px;">SmartFlow Traffic Management System</p>
        </div>
      `
    });

    console.log(`✅ Email OTP sent to ${email}: ${otp}`);
    res.json({ message: "OTP sent to email" });
  } catch (err) {
    console.error("❌ Email send error:", err);
    res.status(500).json({ error: "Email send failed: " + err.message });
  }
});

app.post("/verify-email-otp", (req, res) => {
  const { email, otp } = req.body;

  const key = `email_${email}`;
  const stored = otpStore[key];

  if (!stored) {
    return res.status(400).json({ error: "No OTP found. Request new OTP." });
  }

  if (Date.now() > stored.expires) {
    delete otpStore[key];
    return res.status(400).json({ error: "OTP expired" });
  }

  if (stored.otp != otp) {
    return res.status(400).json({ error: "Invalid OTP" });
  }

  delete otpStore[key];
  res.json({ message: "Email verified successfully" });
});

// ==================== SIGNUP ====================
app.post("/signup", async (req, res) => {
  try {
    const { firstName, lastName, email, mobile, password, role } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const newUser = await User.create({
      name: `${firstName} ${lastName}`,
      email,
      mobile,
      password: hashedPassword,
      role: role || 'user',
      status: 'active',
      isVerified: true,
      loginHistory: []
    });

    console.log(`✅ New user created: ${email}`);
    res.json({ 
      message: "Signup successful", 
      user: { 
        email: newUser.email, 
        name: newUser.name, 
        role: newUser.role 
      } 
    });
  } catch (err) {
    console.error("❌ Signup error:", err);
    res.status(500).json({ error: "Signup failed" });
  }
});

// ==================== LOGIN ====================
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: "User not found" });
    }

    if (user.status === 'blocked') {
      return res.status(403).json({ error: "Your account has been blocked. Contact admin." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid password" });
    }

    user.lastLogin = new Date();
    user.loginHistory.push({
      time: new Date(),
      action: 'Login',
      ip: req.ip || req.connection.remoteAddress,
      device: req.headers['user-agent']
    });
    await user.save();

    console.log(`✅ User logged in: ${email}`);
    res.json({ 
      message: "Login successful", 
      user: { 
        email: user.email, 
        name: user.name, 
        role: user.role,
        status: user.status
      } 
    });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ==================== LOGOUT TRACKING ====================
app.post("/api/logout", async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (user) {
      user.lastLogout = new Date();
      user.loginHistory.push({
        time: new Date(),
        action: 'Logout',
        ip: req.ip || req.connection.remoteAddress,
        device: req.headers['user-agent']
      });
      await user.save();
    }

    res.json({ message: "Logout tracked" });
  } catch (err) {
    console.error("❌ Logout error:", err);
    res.status(500).json({ error: "Logout tracking failed" });
  }
});

// ==================== RESET PASSWORD ====================
app.post("/reset-password", async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: "User not found" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    user.password = hashedPassword;
    await user.save();

    console.log(`✅ Password reset for: ${email}`);
    res.json({ message: "Password reset successful" });
  } catch (err) {
    console.error("❌ Password reset error:", err);
    res.status(500).json({ error: "Password reset failed" });
  }
});

// ==================== THINGSPEAK DATA FETCH ====================
const THINGSPEAK_CHANNEL_ID = 3090158;

app.get("/api/traffic-data", async (req, res) => {
    try {
        const apiKey = process.env.THINGSPEAK_API_KEY;
        
        if (!apiKey) {
            return res.status(500).json({ error: "API key not configured" });
        }

        const response = await fetch(`https://api.thingspeak.com/channels/${THINGSPEAK_CHANNEL_ID}/feeds.json?api_key=${apiKey}&results=8`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== AUTO-STORE THINGSPEAK DATA ====================
async function fetchAndStoreTrafficData() {
  try {
    const apiKey = process.env.THINGSPEAK_API_KEY;
    if (!apiKey) return;

    const response = await fetch(`https://api.thingspeak.com/channels/${THINGSPEAK_CHANNEL_ID}/feeds.json?api_key=${apiKey}&results=1`);
    const data = await response.json();
    
    if (data.feeds && data.feeds.length > 0) {
      const feed = data.feeds[0];
      
      let status = 'Normal';
      let vehicleType = 'Car';
      
      if (feed.field2 && parseInt(feed.field2) > 0) {
        status = 'Priority';
        vehicleType = 'Ambulance';
      } else if (feed.field3 && parseInt(feed.field3) > 0) {
        status = 'Slow';
        vehicleType = 'Truck';
      }
      
      const areas = ['R.S. Puram', 'Sulur', 'Townhall', 'Coimbatore Junction', 'Gandhipuram', 'Mettupalayam Road', 'Peelamedu', 'Singanallur', 'Saibaba Colony', 'Race Course'];
      const areaIndex = Math.floor(Math.random() * areas.length);
      
      const recordId = `#TRF-${Date.now().toString().slice(-4)}`;
      
      const existing = await TrafficRecord.findOne({ 
        dateTime: new Date(feed.created_at) 
      });
      
      if (!existing) {
        const newRecord = new TrafficRecord({
          recordId,
          dateTime: new Date(feed.created_at),
          vehicleType,
          area: areas[areaIndex],
          status,
          field1: feed.field1 || 0,
          field2: feed.field2 || 0,
          field3: feed.field3 || 0,
          field4: feed.field4 || 0,
          field5: feed.field5 || 0,
          field6: feed.field6 || 0
        });
        
        await newRecord.save();
        console.log(`✅ Record stored: ${recordId}`);
      }
    }
  } catch (error) {
    console.error("❌ Error storing traffic data:", error.message);
  }
}

setInterval(fetchAndStoreTrafficData, 30000);
fetchAndStoreTrafficData();

// ==================== GET TRAFFIC RECORDS ====================
app.get("/api/traffic-records", async (req, res) => {
  try {
    const { page = 1, limit = 10, from, to, area, type, emergency } = req.query;
    const skip = (page - 1) * limit;
    
    let query = {};
    
    if (from || to) {
      query.dateTime = {};
      if (from) query.dateTime.$gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        query.dateTime.$lte = toDate;
      }
    }
    
    if (area && area !== '') {
      query.area = area;
    }
    
    if (type && type !== '') {
      query.vehicleType = type;
    }
    
    if (emergency === 'true') {
      query.vehicleType = 'Ambulance';
    }
    
    const records = await TrafficRecord.find(query)
      .sort({ dateTime: -1 })
      .skip(skip)
      .limit(parseInt(limit));
      
    const total = await TrafficRecord.countDocuments(query);
    
    res.json({
      records,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== ADMIN: GET ALL USERS ====================
app.get("/api/admin/users", async (req, res) => {
  try {
    const users = await User.find({}, { password: 0 });
    res.json({ users });
  } catch (error) {
    console.error("❌ Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// ==================== ADMIN: UPDATE USER STATUS ====================
app.put("/api/admin/users/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'blocked'].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const user = await User.findByIdAndUpdate(id, { status }, { new: true });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ message: `User ${status} successfully`, user });
  } catch (error) {
    console.error("❌ Error updating user status:", error);
    res.status(500).json({ error: "Failed to update user status" });
  }
});

// ==================== ADMIN: GET USER ACTIVITY ====================
app.get("/api/admin/activity/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId, { 
      loginHistory: 1, 
      name: 1, 
      email: 1, 
      role: 1, 
      status: 1 
    });
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      user: {
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status
      },
      activity: user.loginHistory.sort((a, b) => b.time - a.time)
    });
  } catch (error) {
    console.error("❌ Error fetching user activity:", error);
    res.status(500).json({ error: "Failed to fetch user activity" });
  }
});

// ==================== VERIFY OTP (Legacy) ====================
app.post("/api/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: "User not found" });
    }

    if (user.otp != otp) {
      return res.status(400).json({ error: "OTP verification failed" });
    }

    user.isVerified = true;
    user.otp = null;
    await user.save();

    res.json({ message: "OTP verified successfully" });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "OTP verification failed" });
  }
});

// ==================== RESEND OTP ====================
app.post("/api/resend-otp", async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: "User not found" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000);
    user.otp = otp;
    await user.save();

    await transporter.sendMail({
      from: `"Traffic Control System" <${process.env.BREVO_EMAIL}>`,
      to: email,
      subject: "OTP Resend",
      html: `<h2>Your OTP is: ${otp}</h2><p>Valid for 5 minutes.</p>`
    });

    res.json({ message: "OTP resent successfully" });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Failed to resend OTP" });
  }
});

// ==================== OAuth Routes ====================
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback"
  },
  (accessToken, refreshToken, profile, done) => done(null, profile)
));

passport.use(new GitHubStrategy({
    clientID: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL: "/auth/github/callback"
  },
  (accessToken, refreshToken, profile, done) => done(null, profile)
));

app.get("/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    prompt: "select_account"
  })
);

app.get("/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/login.html" }),
  (req, res) => {
    res.send(`
      <script>
        window.opener.location.href = "/dashboard.html";
        window.close();
      </script>
    `);
  }
);

app.get("/auth/github",
  passport.authenticate("github", { scope: ["user:email"] })
);

app.get("/auth/github/callback",
  passport.authenticate("github", { failureRedirect: "/login.html" }),
  (req, res) => res.redirect("/dashboard.html")
);

// ==================== Start server ====================
app.listen(PORT, '0.0.0.0', () =>
  console.log(`🚀 Server running on port ${PORT}`)
);