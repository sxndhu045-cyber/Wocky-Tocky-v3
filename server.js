import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json({ limit: "12mb" }));
app.use(express.static(path.join(__dirname, "../frontend")));

const users = new Map();       // demo-only RAM storage
const sessions = new Map();    // demo-only RAM sessions
const sockets = new Map();     // one active WebSocket per user

function id(){ return crypto.randomBytes(12).toString("hex"); }

app.post("/api/register",(req,res)=>{
  const {userId,password,confirmPassword}=req.body;
  if(!userId||!password||!confirmPassword)return res.status(400).json({error:"All fields are required."});
  if(!/^[a-zA-Z0-9_.-]{3,30}$/.test(userId))return res.status(400).json({error:"User ID must be 3–30 characters: letters, numbers, _, . or -."});
  if(password!==confirmPassword)return res.status(400).json({error:"Passwords do not match."});
  if(password.length<6)return res.status(400).json({error:"Password must be at least 6 characters."});
  if(users.has(userId))return res.status(409).json({error:"User ID already exists."});
  users.set(userId,{userId,password});
  res.json({ok:true,userId});
});

app.post("/api/login",(req,res)=>{
  const {userId,password}=req.body,u=users.get(userId);
  if(!u||u.password!==password)return res.status(401).json({error:"Invalid User ID or password."});
  const token=id();sessions.set(token,userId);
  res.json({ok:true,token,userId});
});

app.get("/api/users/:userId",(req,res)=>{
  const userId=req.params.userId;
  if(!users.has(userId))return res.status(404).json({error:"User not found. Check the exact User ID."});
  res.json({userId});
});

app.post("/api/messages",(req,res)=>{
  const {token,to,audio,duration}=req.body,from=sessions.get(token);
  if(!from)return res.status(401).json({error:"Please log in again."});
  if(!users.has(to))return res.status(404).json({error:"Receiver not found."});
  if(!audio)return res.status(400).json({error:"Voice message is empty."});
  const msg={id:id(),from,to,audio,duration:Number(duration)||0,createdAt:Date.now()};
  // Deliberately no database/file persistence. The audio exists only in this request
  // and is immediately forwarded to the currently connected recipient.
  const target=sockets.get(to);
  if(target?.readyState===1)target.send(JSON.stringify({type:"voice-message",message:msg}));
  res.json({ok:true,message:{id:msg.id,from,to,duration:msg.duration}});
});

wss.on("connection",ws=>{
  ws.on("message",raw=>{
    try{
      const d=JSON.parse(raw);
      if(d.type==="auth"){
        const userId=sessions.get(d.token);
        if(userId){ws.userId=userId;sockets.set(userId,ws);ws.send(JSON.stringify({type:"ready",userId}));}
        return;
      }
      if(!ws.userId)return;
      const allowed=["live-offer","live-answer","live-ice","live-ended"];
      if(allowed.includes(d.type)){
        const target=sockets.get(d.to);
        if(target?.readyState===1)target.send(JSON.stringify({...d,from:ws.userId}));
      }
    }catch{}
  });
  ws.on("close",()=>{if(ws.userId && sockets.get(ws.userId)===ws)sockets.delete(ws.userId)});
});

// Express 5-safe fallback (no "*" route syntax).
app.use((req,res)=>res.sendFile(path.join(__dirname,"../frontend/index.html")));

server.listen(3000,()=>console.log("Wocky Tocky running at http://localhost:3000"));
