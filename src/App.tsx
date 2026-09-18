import { useState, useMemo, useCallback, useEffect } from "react"
import type { Session } from "@supabase/supabase-js"
import { supabase } from "./lib/supabaseClient"
import {
  Activity, AlertTriangle, ArrowDownLeft, ArrowRight, Bell, Building2,
  CalendarClock, CheckCircle2, ChevronDown, ChevronRight, CircleCheck,
  Clock, Edit2, Eye, EyeOff, FileText,
  Home, LayoutDashboard, LogOut, Mail, Menu, Plus, RefreshCw,
  RotateCcw, Search, Send, Shield, Trash2, TrendingUp, User,
  Users, Wallet, X, FileSpreadsheet, FilePen, Lock, AlertCircle,
} from "lucide-react"

// ─── TYPES ───────────────────────────────────────────────────────────────────
type Screen = "dashboard" | "financeiro" | "contratos" | "imoveis" | "cadastros"
type InvoiceStatus = "pago" | "pendente" | "atrasado"
type PropertyStatus = "disponivel" | "alugado" | "manutencao"
type GuaranteeType = "caucao" | "fiador" | "seguro"
type AuthMode = "login" | "register" | "forgot"

interface AppUser { id: string; name: string; email: string; role: string }
interface Tenant { id: string; name: string; cpf: string; phone: string; email: string; propertyId?: string }
interface Guarantor { id: string; name: string; cpf: string; phone: string; email: string; contractIds: string[] }
interface Property { id: string; address: string; type: string; status: PropertyStatus; contractId?: string; owner?: string }
interface Contract {
  id: string; tenantId: string; propertyId: string; startDate: string; endDate: string
  rentValue: number; dueDay: number; guarantee: GuaranteeType; cautionValue?: number; guarantorId?: string
  fineRate: number; interestRate: number
}
interface Invoice {
  id: string; contractId: string; tenantId: string; propertyId: string
  dueDate: string; status: InvoiceStatus; baseValue: number; paidDate?: string; note?: string
}
interface TrashItem {
  id: string
  entityType: "tenant" | "guarantor" | "property" | "contract" | "invoice"
  entityName: string
  data: Tenant | Guarantor | Property | Contract | Invoice
  deletedAt: string
  deletedBy: string
}
interface LogEntry {
  id: string
  action: "criar" | "editar" | "excluir" | "restaurar" | "pagar" | "enviar" | "exportar" | "login" | "cadastrar"
  entityType: string
  entityName: string
  at: string
  by: string
  detail?: string
}
interface ToastItem { id: string; message: string; type: "success" | "error" | "info" }

// ─── SEED DATA ────────────────────────────────────────────────────────────────
const SEED_TENANTS: Tenant[] = []

const SEED_GUARANTORS: Guarantor[] = []

const SEED_PROPERTIES: Property[] = []

const SEED_CONTRACTS: Contract[] = []

const TODAY = new Date()
const nowStr = () => new Date().toLocaleString("pt-BR")
const daysDiff = (d: string) => Math.floor((TODAY.getTime() - new Date(d).getTime()) / 86400000)

const SEED_INVOICES: Invoice[] = []

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const fmtDate = (d: string) => { const [y,m,day]=d.split("-"); return `${day}/${m}/${y}` }
const genId = () => Math.random().toString(36).slice(2, 9)
const initials = (name: string) => name.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase()

function calcFine(base: number, daysLate: number, fineRate: number, interestRate: number) {
  const fine = base * (fineRate / 100)
  const interest = base * (interestRate / 100) * Math.ceil(daysLate / 30)
  return { fine, interest, total: base + fine + interest }
}

function generateInvoicesForContract(contract: Contract): Invoice[] {
  const invoices: Invoice[] = []
  const start = new Date(contract.startDate)
  const end = new Date(contract.endDate)
  const cursor = new Date(start.getFullYear(), start.getMonth(), contract.dueDay)
  if (cursor < start) cursor.setMonth(cursor.getMonth() + 1)

  while (cursor <= end) {
    const dueDate = cursor.toISOString().slice(0, 10)
    const status: InvoiceStatus = new Date(dueDate) < TODAY ? "atrasado" : "pendente"
    invoices.push({
      id: "inv" + genId(), contractId: contract.id, tenantId: contract.tenantId, propertyId: contract.propertyId,
      dueDate, status, baseValue: contract.rentValue,
    })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return invoices
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function exportCSV(headers: string[], rows: string[][], filename: string) {
  const lines = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";"))
  const csv = "﻿" + lines.join("\n")
  triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename)
}

function exportContractWord(contract: Contract, tenant: Tenant, property: Property, guarantor?: Guarantor) {
  const guaranteeText = contract.guarantee === "caucao"
    ? `Caução no valor de ${brl(contract.cautionValue || 0)}`
    : contract.guarantee === "fiador"
    ? `Fiança Pessoal — Fiador: ${guarantor?.name || "—"} (CPF: ${guarantor?.cpf || "—"})`
    : "Seguro Fiança"

  const html = `<html><head><meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; font-size: 12pt; line-height: 1.7; margin: 2.5cm; color: #111; }
    h1 { font-size: 17pt; text-align: center; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
    .subtitle { text-align: center; color: #555; font-size: 10pt; margin-bottom: 2em; }
    h2 { font-size: 12pt; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-top: 2em; }
    table { width: 100%; border-collapse: collapse; margin-top: 0.5em; }
    td { padding: 7px 10px; border: 1px solid #ddd; font-size: 11pt; }
    td:first-child { font-weight: bold; width: 35%; background: #f7f7f7; }
    .clause { margin-top: 1.5em; font-size: 11pt; }
    .clause p { margin: 0.5em 0; }
    .signatures { margin-top: 4em; display: flex; gap: 3em; }
    .sig { flex: 1; }
    .sig-line { border-top: 1px solid #333; padding-top: 6px; margin-top: 2.5em; font-size: 10pt; text-align: center; }
    .footer { margin-top: 3em; text-align: center; color: #aaa; font-size: 9pt; border-top: 1px solid #eee; padding-top: 1em; }
  </style></head><body>
  <h1>Contrato de Locação de Imóvel</h1>
  <div class="subtitle">BS Imobiliária — CRECI/SP nº 00000 &nbsp;|&nbsp; Documento gerado em ${new Date().toLocaleDateString("pt-BR")}</div>

  <h2>1. Partes</h2>
  <table>
    <tr><td>Locador/Administradora</td><td>BS Imobiliária LTDA</td></tr>
    <tr><td>Locatário</td><td>${tenant.name}</td></tr>
    <tr><td>CPF do Locatário</td><td>${tenant.cpf}</td></tr>
    <tr><td>Telefone</td><td>${tenant.phone}</td></tr>
    <tr><td>E-mail</td><td>${tenant.email}</td></tr>
  </table>

  <h2>2. Imóvel Locado</h2>
  <table>
    <tr><td>Endereço</td><td>${property.address}</td></tr>
    <tr><td>Tipo</td><td>${property.type}</td></tr>
  </table>

  <h2>3. Condições Financeiras</h2>
  <table>
    <tr><td>Valor Mensal do Aluguel</td><td>${brl(contract.rentValue)}</td></tr>
    <tr><td>Dia de Vencimento</td><td>Todo dia ${contract.dueDay} de cada mês</td></tr>
    <tr><td>Multa por Atraso</td><td>${contract.fineRate}% sobre o valor do aluguel</td></tr>
    <tr><td>Juros por Atraso</td><td>${contract.interestRate}% ao mês</td></tr>
  </table>

  <h2>4. Vigência</h2>
  <table>
    <tr><td>Data de Início</td><td>${fmtDate(contract.startDate)}</td></tr>
    <tr><td>Data de Término</td><td>${fmtDate(contract.endDate)}</td></tr>
  </table>

  <h2>5. Garantia Locatícia</h2>
  <table><tr><td>Modalidade</td><td>${guaranteeText}</td></tr></table>

  <div class="clause">
    <h2>6. Disposições Gerais</h2>
    <p>O locatário se compromete a zelar pelo imóvel e restituí-lo nas mesmas condições em que o recebeu, salvo desgaste natural pelo uso regular.</p>
    <p>Qualquer alteração ou benfeitoria no imóvel deverá ser previamente autorizada pela administradora por escrito.</p>
    <p>O presente contrato é regido pela Lei nº 8.245/91 (Lei do Inquilinato) e pelas condições específicas nele estabelecidas.</p>
  </div>

  <div class="signatures">
    <div class="sig"><div class="sig-line">BS Imobiliária LTDA<br>Administradora</div></div>
    <div class="sig"><div class="sig-line">${tenant.name}<br>Locatário</div></div>
    ${guarantor ? `<div class="sig"><div class="sig-line">${guarantor.name}<br>Fiador</div></div>` : ""}
  </div>

  <div class="footer">BS Imobiliária — Documento gerado automaticamente pelo sistema de gestão</div>
  </body></html>`

  triggerDownload(
    new Blob([html], { type: "application/msword" }),
    `contrato-${tenant.name.split(" ")[0].toLowerCase()}-${contract.id}.doc`
  )
}

// ─── STATUS BADGE ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    pago:       ["badge-paid",    "Pago"],
    pendente:   ["badge-pending", "Pendente"],
    atrasado:   ["badge-late",    "Atrasado"],
    disponivel: ["badge-avail",   "Disponível"],
    alugado:    ["badge-rented",  "Alugado"],
    manutencao: ["badge-maint",   "Manutenção"],
  }
  const [cls, label] = map[status] || ["badge-pending", status]
  return <span className={`badge ${cls}`}>{label}</span>
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function Toasts({ toasts }: { toasts: ToastItem[] }) {
  if (!toasts.length) return null
  const icons = { success: <CircleCheck size={15} />, error: <AlertTriangle size={15} />, info: <Bell size={15} /> }
  const colors = { success: "#0ea56e", error: "#D31522", info: "#3b82f6" }
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, display: "flex", flexDirection: "column", gap: 8, zIndex: 9999 }}>
      {toasts.map(t => (
        <div key={t.id} className="toast-in" style={{
          background: colors[t.type], color: "#fff", padding: "12px 18px", borderRadius: 10,
          fontSize: 13.5, fontWeight: 500, boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
          minWidth: 260, display: "flex", alignItems: "center", gap: 9,
        }}>
          {icons[t.type]}{t.message}
        </div>
      ))}
    </div>
  )
}

// ─── BTN ─────────────────────────────────────────────────────────────────────
interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "danger" | "ghost" | "outline" | "success"
  size?: "sm" | "md"
  icon?: React.ReactNode
}
function Btn({ variant = "primary", size = "md", icon, children, style, ...rest }: BtnProps) {
  const sz = size === "sm"
    ? { padding: "5px 12px", fontSize: 12 }
    : { padding: "9px 18px", fontSize: 13 }
  const vars: Record<string, React.CSSProperties> = {
    primary: { background: "var(--navy)", color: "#fff" },
    danger:  { background: "var(--red)",  color: "#fff" },
    success: { background: "var(--success)", color: "#fff" },
    ghost:   { background: "transparent", color: "var(--text-sub)" },
    outline: { background: "#fff", color: "var(--navy)", border: "1.5px solid var(--border)" },
  }
  return (
    <button
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, border: "none",
        borderRadius: 8, cursor: "pointer", fontWeight: 600, fontFamily: "var(--font)",
        transition: "opacity 0.15s, transform 0.1s", ...sz, ...vars[variant], ...style,
      }}
      onMouseEnter={e => { e.currentTarget.style.opacity = "0.85"; e.currentTarget.style.transform = "translateY(-1px)" }}
      onMouseLeave={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "translateY(0)" }}
      {...rest}
    >
      {icon}{children}
    </button>
  )
}

// ─── MODAL ────────────────────────────────────────────────────────────────────
function Modal({ onClose, title, children, width = 500 }: {
  onClose: () => void; title: string; children: React.ReactNode; width?: number
}) {
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: width }}>
        <div className="modal-header">
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{title}</h2>
          <button onClick={onClose} className="modal-close"><X size={17} /></button>
        </div>
        <div style={{ padding: "16px 24px 24px" }}>{children}</div>
      </div>
    </div>
  )
}

// ─── CONFIRM MODAL ────────────────────────────────────────────────────────────
function ConfirmModal({ title, message, confirmLabel = "Excluir", onConfirm, onClose }: {
  title: string; message: string; confirmLabel?: string; onConfirm: () => void; onClose: () => void
}) {
  return (
    <Modal onClose={onClose} title={title} width={400}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--red-dim)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <AlertTriangle size={18} style={{ color: "var(--red)" }} />
          </div>
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-sub)", lineHeight: 1.6 }}>{message}</p>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn variant="danger" onClick={() => { onConfirm(); onClose() }}>{confirmLabel}</Btn>
        </div>
      </div>
    </Modal>
  )
}

// ─── FORM PRIMITIVES ─────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--text-sub)", marginBottom: 5, letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</label>
      {children}
    </div>
  )
}
const inputCss: React.CSSProperties = {
  width: "100%", border: "1.5px solid var(--border)", borderRadius: 8,
  padding: "9px 12px", fontSize: 13.5, color: "var(--text)", outline: "none",
  background: "#fff", transition: "border-color 0.15s", boxSizing: "border-box",
}
function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      style={inputCss}
      onFocus={e => (e.target.style.borderColor = "var(--navy)")}
      onBlur={e => (e.target.style.borderColor = "var(--border)")}
      {...props}
    />
  )
}
function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      style={{ ...inputCss, resize: "vertical", minHeight: 80 }}
      onFocus={e => (e.target.style.borderColor = "var(--navy)")}
      onBlur={e => (e.target.style.borderColor = "var(--border)")}
      {...props}
    />
  )
}
function Sel({ children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div style={{ position: "relative" }}>
      <select
        style={{ ...inputCss, appearance: "none", cursor: "pointer", paddingRight: 32 }}
        onFocus={e => (e.target.style.borderColor = "var(--navy)")}
        onBlur={e => (e.target.style.borderColor = "var(--border)")}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown size={13} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
    </div>
  )
}

// ─── PAGE HEADER ─────────────────────────────────────────────────────────────
function PageHeader({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.03em" }}>{title}</h1>
        {sub && <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--text-muted)" }}>{sub}</p>}
      </div>
      {action && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{action}</div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LOGIN SCREEN
// ═══════════════════════════════════════════════════════════════════════════════
function LoginScreen({ onLogin, onRegister, onForgot }: {
  onLogin: (email: string, password: string) => Promise<{ error?: string }>
  onRegister: (name: string, email: string, password: string, role: string) => Promise<{ error?: string }>
  onForgot: (email: string) => Promise<{ error?: string }>
}) {
  const [mode, setMode] = useState<AuthMode>("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [role, setRole] = useState("Financeiro")
  const [confirmPass, setConfirmPass] = useState("")
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState("")
  const [forgotSent, setForgotSent] = useState(false)
  const [registerDone, setRegisterDone] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    if (!email || !password) { setError("Preencha e-mail e senha."); return }
    setError(""); setLoading(true)
    const { error } = await onLogin(email, password)
    setLoading(false)
    if (error) setError(error)
  }

  const handleRegister = async () => {
    if (!name || !email || !password) { setError("Preencha todos os campos obrigatórios."); return }
    if (password !== confirmPass) { setError("As senhas não coincidem."); return }
    if (password.length < 6) { setError("A senha deve ter pelo menos 6 caracteres."); return }
    setError(""); setLoading(true)
    const { error } = await onRegister(name, email, password, role)
    setLoading(false)
    if (error) { setError(error); return }
    setRegisterDone(true)
  }

  const handleForgot = async () => {
    if (!email) { setError("Informe o e-mail cadastrado."); return }
    setError(""); setLoading(true)
    const { error } = await onForgot(email)
    setLoading(false)
    if (error) { setError(error); return }
    setForgotSent(true)
  }

  return (
    <div className="login-root">
      {/* Left panel */}
      <div className="login-left">
        <div className="login-brand">
          <div className="login-logo">BS</div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: "-0.03em" }}>BS Imobiliária</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", fontWeight: 400 }}>Gestão Imobiliária Profissional</div>
          </div>
        </div>
        <div className="login-tagline">
          <div style={{ fontSize: 32, fontWeight: 800, color: "#fff", lineHeight: 1.25, letterSpacing: "-0.04em", marginBottom: 16 }}>
            Controle total<br />do seu portfólio<br />imobiliário
          </div>
          <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 14, lineHeight: 1.7, maxWidth: 340 }}>
            Gerencie contratos, inquilinos, inadimplência e financeiro em um só lugar — com segurança e agilidade.
          </p>
        </div>
        <div className="login-features">
          {[
            ["Dashboard financeiro em tempo real", "Acompanhe receitas, atrasos e vencimentos"],
            ["Contratos inteligentes", "Geração automática com garantias configuráveis"],
            ["Exportação profissional", "Excel e Word com um clique"],
          ].map(([title, desc]) => (
            <div key={title} className="login-feature-item">
              <div className="login-feature-dot" />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{title}</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginTop: 1 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="login-right">
        <div className="login-card">
          {/* Tabs */}
          <div className="login-tabs">
            {([["login", "Entrar"], ["register", "Cadastrar"], ["forgot", "Recuperar Senha"]] as [AuthMode, string][]).map(([m, l]) => (
              <button key={m} onClick={() => { setMode(m); setError(""); setForgotSent(false); setRegisterDone(false) }}
                className={`login-tab ${mode === m ? "active" : ""}`}>{l}</button>
            ))}
          </div>

          {mode === "login" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.03em" }}>Bem-vindo de volta</div>
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 3 }}>Acesse sua conta</div>
              </div>
              <Field label="E-mail">
                <div style={{ position: "relative" }}>
                  <Mail size={14} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                  <Input style={{ paddingLeft: 34 }} type="email" placeholder="seu@email.com.br" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} />
                </div>
              </Field>
              <Field label="Senha">
                <div style={{ position: "relative" }}>
                  <Lock size={14} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                  <Input style={{ paddingLeft: 34, paddingRight: 38 }} type={showPass ? "text" : "password"} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} />
                  <button onClick={() => setShowPass(s => !s)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}>
                    {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </Field>
              {error && <div className="login-error"><AlertCircle size={13} />{error}</div>}
              <Btn style={{ width: "100%", justifyContent: "center", padding: "11px 18px", fontSize: 14 }} onClick={handleLogin} disabled={loading}>
                {loading ? "Entrando…" : "Entrar no sistema"}
              </Btn>
              <div style={{ textAlign: "center" }}>
                <button onClick={() => { setMode("forgot"); setError("") }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--navy)", fontSize: 13, fontWeight: 600 }}>
                  Esqueci minha senha
                </button>
              </div>
            </div>
          )}

          {mode === "register" && (
            registerDone ? (
              <div style={{ textAlign: "center", padding: "16px 0" }}>
                <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--success-dim)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
                  <CircleCheck size={26} style={{ color: "var(--success)" }} />
                </div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Cadastro realizado!</div>
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Confirme sua conta pelo link enviado para <strong>{email}</strong> e depois faça login.</div>
                <Btn variant="ghost" style={{ marginTop: 16, width: "100%", justifyContent: "center" }} onClick={() => { setMode("login"); setRegisterDone(false) }}>
                  Ir para o login
                </Btn>
              </div>
            ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ marginBottom: 4 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.03em" }}>Criar conta</div>
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 3 }}>Preencha os dados do novo usuário</div>
              </div>
              <Field label="Nome completo">
                <Input placeholder="Seu nome" value={name} onChange={e => setName(e.target.value)} />
              </Field>
              <Field label="E-mail">
                <Input type="email" placeholder="seu@email.com.br" value={email} onChange={e => setEmail(e.target.value)} />
              </Field>
              <Field label="Perfil de acesso">
                <Sel value={role} onChange={e => setRole(e.target.value)}>
                  {["Financeiro", "Gerente", "Administrador", "Visualizador"].map(r => <option key={r}>{r}</option>)}
                </Sel>
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Senha">
                  <Input type={showPass ? "text" : "password"} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
                </Field>
                <Field label="Confirmar senha">
                  <Input type={showPass ? "text" : "password"} placeholder="••••••••" value={confirmPass} onChange={e => setConfirmPass(e.target.value)} />
                </Field>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "var(--text-sub)" }}>
                <input type="checkbox" checked={showPass} onChange={e => setShowPass(e.target.checked)} /> Mostrar senhas
              </label>
              {error && <div className="login-error"><AlertCircle size={13} />{error}</div>}
              <Btn style={{ width: "100%", justifyContent: "center", padding: "11px 18px", fontSize: 14 }} onClick={handleRegister} disabled={loading}>
                {loading ? "Criando…" : "Criar conta"}
              </Btn>
            </div>
            )
          )}

          {mode === "forgot" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ marginBottom: 4 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.03em" }}>Recuperar acesso</div>
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 3 }}>Enviaremos um link para seu e-mail</div>
              </div>
              {!forgotSent ? (
                <>
                  <Field label="E-mail cadastrado">
                    <div style={{ position: "relative" }}>
                      <Mail size={14} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                      <Input style={{ paddingLeft: 34 }} type="email" placeholder="seu@email.com.br" value={email} onChange={e => setEmail(e.target.value)} />
                    </div>
                  </Field>
                  {error && <div className="login-error"><AlertCircle size={13} />{error}</div>}
                  <Btn style={{ width: "100%", justifyContent: "center", padding: "11px 18px", fontSize: 14 }} onClick={handleForgot} disabled={loading}>
                    {loading ? "Enviando…" : "Enviar link de recuperação"}
                  </Btn>
                </>
              ) : (
                <div style={{ textAlign: "center", padding: "16px 0" }}>
                  <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--success-dim)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
                    <CircleCheck size={26} style={{ color: "var(--success)" }} />
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Link enviado!</div>
                  <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Verifique a caixa de entrada de <strong>{email}</strong></div>
                  <Btn variant="ghost" style={{ marginTop: 16, width: "100%", justifyContent: "center" }} onClick={() => { setMode("login"); setForgotSent(false) }}>
                    Voltar ao login
                  </Btn>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SIDEBAR
// ═══════════════════════════════════════════════════════════════════════════════
const NAV = [
  { id: "dashboard",  icon: LayoutDashboard, label: "Dashboard" },
  { id: "financeiro", icon: Wallet,          label: "Financeiro" },
  { id: "contratos",  icon: FileText,        label: "Contratos" },
  { id: "imoveis",    icon: Building2,       label: "Imóveis" },
  { id: "cadastros",  icon: Users,           label: "Cadastros" },
]

function Sidebar({ screen, setScreen, user, onLogout, trashCount, onTrash, logCount, onLog, open, onClose }: {
  screen: Screen; setScreen: (s: Screen) => void; user: AppUser
  onLogout: () => void; trashCount: number; onTrash: () => void; logCount: number; onLog: () => void
  open: boolean; onClose: () => void
}) {
  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose} />}
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-logo">
          <div className="sidebar-logo-mark">BS</div>
          <div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 13, lineHeight: 1.2, letterSpacing: "-0.02em" }}>BS Imobiliária</div>
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, fontWeight: 500, marginTop: 1 }}>Escritório Imobiliário</div>
          </div>
        </div>

        <nav style={{ padding: "10px 8px", flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
          {NAV.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              className={`nav-item ${screen === id ? "active" : ""}`}
              onClick={() => { setScreen(id as Screen); onClose() }}
            >
              <Icon size={16} style={{ flexShrink: 0 }} />
              {label}
            </button>
          ))}
        </nav>

        <div style={{ padding: "8px 8px 0" }}>
          <button className="nav-item" onClick={onLog} style={{ width: "100%" }}>
            <Activity size={16} style={{ flexShrink: 0 }} />
            Log de Atividades
            {logCount > 0 && <span className="nav-badge">{Math.min(logCount, 99)}</span>}
          </button>
          <button className="nav-item" onClick={onTrash} style={{ width: "100%" }}>
            <Trash2 size={16} style={{ flexShrink: 0 }} />
            Lixeira
            {trashCount > 0 && <span className="nav-badge" style={{ background: "var(--red)" }}>{trashCount}</span>}
          </button>
        </div>

        <div className="sidebar-user">
          <div className="sidebar-avatar">{initials(user.name)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "#fff", fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.name}</div>
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>{user.role}</div>
          </div>
          <button onClick={onLogout} title="Sair" style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.4)", padding: 4, display: "flex", borderRadius: 6, transition: "color 0.15s" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#fff")} onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}>
            <LogOut size={15} />
          </button>
        </div>
      </aside>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TRASH MODAL
// ═══════════════════════════════════════════════════════════════════════════════
function TrashModal({ items, onRestore, onDelete, onClose }: {
  items: TrashItem[]
  onRestore: (item: TrashItem) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const typeLabels: Record<string, string> = {
    tenant: "Inquilino", guarantor: "Fiador", property: "Imóvel",
    contract: "Contrato", invoice: "Fatura",
  }
  const typeColors: Record<string, string> = {
    tenant: "var(--info)", guarantor: "var(--warning)", property: "var(--success)",
    contract: "var(--navy)", invoice: "var(--red)",
  }

  return (
    <Modal onClose={onClose} title="Lixeira" width={580}>
      {items.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
          <Trash2 size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
          <div style={{ fontSize: 14 }}>Lixeira vazia</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 480, overflowY: "auto" }}>
          {items.map(item => (
            <div key={item.id} style={{ border: "1.5px solid var(--border)", borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Trash2 size={15} style={{ color: typeColors[item.entityType] }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, background: "var(--bg)", color: typeColors[item.entityType], padding: "1px 7px", borderRadius: 99, border: "1px solid var(--border)" }}>
                    {typeLabels[item.entityType]}
                  </span>
                </div>
                <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.entityName}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                  Excluído por <strong>{item.deletedBy}</strong> em {item.deletedAt}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <Btn size="sm" variant="outline" icon={<RotateCcw size={12} />} onClick={() => onRestore(item)}>Restaurar</Btn>
                <Btn size="sm" variant="danger" icon={<X size={12} />} onClick={() => setConfirmId(item.id)} />
              </div>
            </div>
          ))}
        </div>
      )}
      {confirmId && (
        <ConfirmModal
          title="Excluir permanentemente"
          message="Este item será removido definitivamente e não poderá ser recuperado."
          confirmLabel="Excluir permanentemente"
          onConfirm={() => { onDelete(confirmId); setConfirmId(null) }}
          onClose={() => setConfirmId(null)}
        />
      )}
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LOG MODAL
// ═══════════════════════════════════════════════════════════════════════════════
function LogModal({ entries, onClose }: { entries: LogEntry[]; onClose: () => void }) {
  const actionColors: Record<string, string> = {
    criar: "var(--success)", editar: "var(--info)", excluir: "var(--red)",
    restaurar: "var(--warning)", pagar: "var(--success)", enviar: "var(--info)",
    exportar: "var(--navy)", login: "var(--navy)", cadastrar: "var(--success)",
  }
  const actionLabels: Record<string, string> = {
    criar: "Criou", editar: "Editou", excluir: "Excluiu",
    restaurar: "Restaurou", pagar: "Registrou pagamento", enviar: "Enviou cobrança",
    exportar: "Exportou", login: "Login", cadastrar: "Cadastrou",
  }

  return (
    <Modal onClose={onClose} title="Log de Atividades" width={560}>
      {entries.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
          <Activity size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
          <div>Nenhuma atividade registrada ainda.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 1, maxHeight: 480, overflowY: "auto" }}>
          {[...entries].reverse().map((e, i) => (
            <div key={e.id} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: i < entries.length - 1 ? "1px solid var(--border-sub)" : "none", alignItems: "flex-start" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: actionColors[e.action] || "var(--text-muted)", marginTop: 5, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: "var(--text)" }}>
                  <strong>{e.by}</strong> {actionLabels[e.action] || e.action} <strong>{e.entityName}</strong>
                  {e.detail && <span style={{ color: "var(--text-muted)" }}> — {e.detail}</span>}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{e.at} · {e.entityType}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
function Dashboard({ invoices, contracts, tenants, properties, setScreen, addLog, addToast }: {
  invoices: Invoice[]; contracts: Contract[]; tenants: Tenant[]; properties: Property[]
  setScreen: (s: Screen) => void; addLog: (e: Omit<LogEntry, "id" | "at" | "by">) => void
  addToast: (m: string, t?: ToastItem["type"]) => void
}) {
  const currentMonth = TODAY.toISOString().slice(0, 7)
  const lateInvoices = invoices.filter(i => i.status === "atrasado")
  const paidThisMonth = invoices.filter(i => i.status === "pago" && i.paidDate?.startsWith(currentMonth))
  const totalPaid = paidThisMonth.reduce((a, i) => a + i.baseValue, 0)

  const expiringContracts = contracts.filter(c => {
    const diff = (new Date(c.endDate).getTime() - TODAY.getTime()) / 86400000
    return diff >= 0 && diff <= 60
  })

  const receivableNext7 = invoices
    .filter(i => { if (i.status !== "pendente") return false; const diff = (new Date(i.dueDate).getTime() - TODAY.getTime()) / 86400000; return diff >= 0 && diff <= 7 })
    .reduce((a, i) => a + i.baseValue, 0)

  const totalReceivable = invoices.filter(i => i.status !== "pago").reduce((a, i) => a + i.baseValue, 0)
  const [sentAlert, setSentAlert] = useState<Set<string>>(new Set())
  const [showManualPayment, setShowManualPayment] = useState(false)
  const lateRate = Math.round((lateInvoices.length / Math.max(contracts.length, 1)) * 100)

  const handleSendAlert = (invId: string, tenantName: string) => {
    setSentAlert(s => new Set([...s, invId]))
    addLog({ action: "enviar", entityType: "Fatura", entityName: `Cobrança para ${tenantName}` })
    addToast(`Cobrança enviada para ${tenantName}`, "success")
  }

  const summaryCards = [
    { label: "Receitas do Mês", value: brl(totalPaid), sub: `${TODAY.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })} · recebido`, icon: TrendingUp, iconColor: "var(--success)", iconBg: "var(--success-dim)", accent: "var(--success)" },
    { label: "Inadimplência", value: `${lateInvoices.length} aluguéis`, sub: `${lateRate}% da carteira em atraso`, icon: AlertTriangle, iconColor: "var(--red)", iconBg: "var(--red-dim)", accent: "var(--red)" },
    { label: "A Receber (7 dias)", value: brl(receivableNext7), sub: "Vencimentos próximos", icon: CalendarClock, iconColor: "var(--info)", iconBg: "var(--info-dim)", accent: "var(--info)" },
    { label: "Total em Aberto", value: brl(totalReceivable), sub: `${invoices.filter(i => i.status !== "pago").length} faturas pendentes`, icon: Wallet, iconColor: "var(--warning)", iconBg: "var(--warning-dim)", accent: "var(--warning)" },
  ]

  return (
    <div>
      <PageHeader
        title="Dashboard"
        sub={`Atualizado em ${TODAY.toLocaleDateString("pt-BR")} às ${TODAY.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}
        action={
          <>
            <Btn variant="outline" size="sm" icon={<ArrowDownLeft size={13} />} onClick={() => setShowManualPayment(true)}>Baixa Manual</Btn>
            <Btn size="sm" icon={<RefreshCw size={13} />} onClick={() => addToast("Dados sincronizados", "success")}>Sincronizar</Btn>
          </>
        }
      />

      <div className="summary-cards">
        {summaryCards.map(({ label, value, sub, icon: Icon, iconColor, iconBg, accent }) => (
          <div key={label} className="stat-card">
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: accent, borderRadius: "14px 14px 0 0" }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</span>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon size={16} style={{ color: iconColor }} />
              </div>
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.04em", lineHeight: 1, marginBottom: 5 }}>{value}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{sub}</div>
          </div>
        ))}
      </div>

      <div className="dashboard-grid">
        {/* Late queue */}
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="card-header">
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--red)" }} className="pulse-red" />
              <span style={{ fontWeight: 700, fontSize: 14 }}>Fila de Ação — Atrasos</span>
              <span className="count-badge" style={{ background: "var(--red-dim)", color: "var(--red)" }}>{lateInvoices.length}</span>
            </div>
            <button className="link-btn" onClick={() => setScreen("financeiro")}>
              Ver todos <ChevronRight size={13} />
            </button>
          </div>
          <div className="table-head" style={{ gridTemplateColumns: "1fr 160px 80px 100px 140px" }}>
            <span>Inquilino</span><span>Imóvel</span><span>Atraso</span><span style={{ textAlign: "right" }}>Total c/ multa</span><span style={{ textAlign: "center" }}>Ação</span>
          </div>
          {lateInvoices.map((inv, i) => {
            const contract = contracts.find(c => c.id === inv.contractId)!
            const tenant = tenants.find(t => t.id === inv.tenantId)!
            const property = properties.find(p => p.id === inv.propertyId)!
            const days = daysDiff(inv.dueDate)
            const { total } = calcFine(inv.baseValue, days, contract.fineRate, contract.interestRate)
            const sent = sentAlert.has(inv.id)
            return (
              <div key={inv.id} className="trow" style={{ gridTemplateColumns: "1fr 160px 80px 100px 140px", borderBottom: i < lateInvoices.length - 1 ? "1px solid var(--border-sub)" : "none" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{tenant.name.split(" ").slice(0, 2).join(" ")}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Venc. {fmtDate(inv.dueDate)}</div>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-sub)" }}>{property.address.split("–")[0].trim()}</div>
                <div><span className="days-badge">{days}d</span></div>
                <div style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700, color: "var(--red)" }}>{brl(total)}</div>
                <div style={{ textAlign: "center" }}>
                  <Btn size="sm" variant={sent ? "ghost" : "danger"} icon={sent ? <CheckCircle2 size={12} /> : <Send size={12} />}
                    onClick={() => handleSendAlert(inv.id, tenant.name)} style={{ fontSize: 11 }}>
                    {sent ? "Enviado" : "Cobrar"}
                  </Btn>
                </div>
              </div>
            )
          })}
          {lateInvoices.length === 0 && (
            <div style={{ padding: "32px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              <CircleCheck size={24} style={{ marginBottom: 8, color: "var(--success)" }} /><br />
              Nenhuma fatura em atraso.
            </div>
          )}
        </div>

        {/* Right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Quick actions */}
          <div className="card">
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, color: "var(--text)" }}>Ações Rápidas</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <Btn style={{ width: "100%", justifyContent: "flex-start" }} icon={<Plus size={14} />} onClick={() => setScreen("contratos")}>Novo Contrato</Btn>
              <Btn variant="outline" style={{ width: "100%", justifyContent: "flex-start" }} icon={<ArrowDownLeft size={14} />} onClick={() => setShowManualPayment(true)}>Baixa Manual de Pagamento</Btn>
              <Btn variant="outline" style={{ width: "100%", justifyContent: "flex-start" }} icon={<Building2 size={14} />} onClick={() => setScreen("imoveis")}>Cadastrar Imóvel</Btn>
              <Btn variant="outline" style={{ width: "100%", justifyContent: "flex-start" }} icon={<User size={14} />} onClick={() => setScreen("cadastros")}>Novo Inquilino</Btn>
            </div>
          </div>

          {/* Expiring */}
          <div className="card" style={{ background: "var(--warning-dim)", border: "1.5px solid rgba(245,158,11,0.25)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <Clock size={14} style={{ color: "var(--warning)" }} />
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "#92400e" }}>Contratos Vencendo em 60 dias</span>
              <span className="count-badge" style={{ background: "rgba(245,158,11,0.2)", color: "#92400e" }}>{expiringContracts.length}</span>
            </div>
            {expiringContracts.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Nenhum contrato vencendo em breve.</div>
            ) : expiringContracts.map(c => {
              const t = tenants.find(t => t.id === c.tenantId)!
              const days = Math.ceil((new Date(c.endDate).getTime() - TODAY.getTime()) / 86400000)
              return (
                <div key={c.id} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid rgba(245,158,11,0.15)" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>{t.name.split(" ").slice(0, 2).join(" ")}</div>
                  <div style={{ fontSize: 11.5, color: "#92400e" }}>Vence em {days} dia{days !== 1 ? "s" : ""} · {fmtDate(c.endDate)}</div>
                </div>
              )
            })}
          </div>

          {/* Property summary */}
          <div className="card">
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Portfólio</div>
            {[
              ["Imóveis alugados", properties.filter(p => p.status === "alugado").length, "var(--info)"],
              ["Disponíveis", properties.filter(p => p.status === "disponivel").length, "var(--success)"],
              ["Em manutenção", properties.filter(p => p.status === "manutencao").length, "var(--warning)"],
            ].map(([l, v, c]) => (
              <div key={l as string} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid var(--border-sub)" }}>
                <span style={{ fontSize: 13, color: "var(--text-sub)" }}>{l}</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: c as string, fontFamily: "var(--mono)" }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showManualPayment && (
        <ManualPaymentModal
          invoices={invoices.filter(i => i.status !== "pago")}
          tenants={tenants}
          onClose={() => setShowManualPayment(false)}
          addLog={addLog}
          addToast={addToast}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FINANCEIRO
// ═══════════════════════════════════════════════════════════════════════════════
type FinFilter = "todos" | "atrasados" | "semana" | "pagos"

function Financeiro({ invoices, contracts, tenants, properties, addLog, addToast, setInvoices, addToTrash }: {
  invoices: Invoice[]; contracts: Contract[]; tenants: Tenant[]; properties: Property[]
  addLog: (e: Omit<LogEntry, "id" | "at" | "by">) => void
  addToast: (m: string, t?: ToastItem["type"]) => void
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>
  addToTrash: (item: Omit<TrashItem, "id" | "deletedAt" | "deletedBy">) => void
}) {
  const [filter, setFilter] = useState<FinFilter>("todos")
  const [search, setSearch] = useState("")
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Invoice | null>(null)

  const currentMonth = TODAY.toISOString().slice(0, 7)

  const filtered = useMemo(() => {
    let list = [...invoices]
    if (filter === "atrasados") list = list.filter(i => i.status === "atrasado")
    if (filter === "pagos") list = list.filter(i => i.status === "pago" && i.paidDate?.startsWith(currentMonth))
    if (filter === "semana") list = list.filter(i => { if (i.status === "pago") return false; const diff = (new Date(i.dueDate).getTime() - TODAY.getTime()) / 86400000; return diff >= 0 && diff <= 7 })
    if (search) { const s = search.toLowerCase(); list = list.filter(i => tenants.find(t => t.id === i.tenantId)?.name.toLowerCase().includes(s)) }
    return list.sort((a, b) => b.dueDate.localeCompare(a.dueDate))
  }, [invoices, filter, search, tenants, currentMonth])

  const handleExportCSV = () => {
    exportCSV(
      ["Inquilino", "CPF", "Imóvel", "Vencimento", "Status", "Valor Base", "Multa", "Juros", "Total"],
      filtered.map(inv => {
        const contract = contracts.find(c => c.id === inv.contractId)!
        const tenant = tenants.find(t => t.id === inv.tenantId)!
        const property = properties.find(p => p.id === inv.propertyId)!
        const days = inv.status === "atrasado" ? daysDiff(inv.dueDate) : 0
        const { fine, interest, total } = calcFine(inv.baseValue, days, contract.fineRate, contract.interestRate)
        return [tenant.name, tenant.cpf, property.address, fmtDate(inv.dueDate), inv.status, String(inv.baseValue), String(inv.status === "atrasado" ? fine.toFixed(2) : 0), String(inv.status === "atrasado" ? interest.toFixed(2) : 0), String(inv.status === "atrasado" ? total.toFixed(2) : inv.baseValue)]
      }),
      "faturas-bs-imobiliaria.csv"
    )
    addLog({ action: "exportar", entityType: "Financeiro", entityName: "Tabela de Faturas", detail: `${filtered.length} registros` })
    addToast("Exportado para Excel com sucesso", "success")
  }

  const handleDelete = (inv: Invoice) => {
    const tenant = tenants.find(t => t.id === inv.tenantId)
    addToTrash({ entityType: "invoice", entityName: `Fatura ${tenant?.name} · ${fmtDate(inv.dueDate)}`, data: inv })
    setInvoices(prev => prev.filter(i => i.id !== inv.id))
    addLog({ action: "excluir", entityType: "Fatura", entityName: `${tenant?.name} · ${fmtDate(inv.dueDate)}` })
    addToast("Fatura movida para a lixeira", "info")
    setDeleteTarget(null)
  }

  const handleMarkPaid = (inv: Invoice) => {
    setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, status: "pago", paidDate: TODAY.toISOString().slice(0, 10) } : i))
    const tenant = tenants.find(t => t.id === inv.tenantId)
    addLog({ action: "pagar", entityType: "Fatura", entityName: `${tenant?.name} · ${fmtDate(inv.dueDate)}` })
    addToast("Pagamento registrado com sucesso", "success")
    setSelectedInvoice(null)
  }

  const filterBtns: [FinFilter, string, number][] = [
    ["todos", "Todos", invoices.length],
    ["atrasados", "Atrasados", invoices.filter(i => i.status === "atrasado").length],
    ["semana", "Esta Semana", invoices.filter(i => { if (i.status === "pago") return false; const d = (new Date(i.dueDate).getTime() - TODAY.getTime()) / 86400000; return d >= 0 && d <= 7 }).length],
    ["pagos", "Pagos no Mês", invoices.filter(i => i.status === "pago" && i.paidDate?.startsWith(currentMonth)).length],
  ]

  return (
    <div>
      <PageHeader title="Controle Financeiro" sub="Gestão de faturas e recebimentos"
        action={
          <Btn variant="outline" size="sm" icon={<FileSpreadsheet size={13} />} onClick={handleExportCSV}>Exportar Excel</Btn>
        }
      />

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div className="filter-bar">
          {filterBtns.map(([v, l, n]) => (
            <button key={v} onClick={() => setFilter(v)} className={`filter-btn ${filter === v ? "active" : ""}`}>
              {l} {n > 0 && <span className="filter-count">{n}</span>}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 200, position: "relative" }}>
          <Search size={13} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
          <input className="search-input" placeholder="Buscar inquilino…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="card" style={{ overflow: "hidden", padding: 0 }}>
        <div className="table-head" style={{ gridTemplateColumns: "1.3fr 1.1fr 100px 90px 110px 110px 80px" }}>
          <span>Inquilino</span><span>Imóvel</span><span>Vencimento</span><span>Status</span>
          <span style={{ textAlign: "right" }}>Base</span><span style={{ textAlign: "right" }}>Total</span><span />
        </div>
        {filtered.map((inv, i) => {
          const contract = contracts.find(c => c.id === inv.contractId)!
          const tenant = tenants.find(t => t.id === inv.tenantId)!
          const property = properties.find(p => p.id === inv.propertyId)!
          const days = inv.status === "atrasado" ? daysDiff(inv.dueDate) : 0
          const { total } = calcFine(inv.baseValue, days, contract.fineRate, contract.interestRate)
          return (
            <div key={inv.id} className="trow" style={{ gridTemplateColumns: "1.3fr 1.1fr 100px 90px 110px 110px 80px", borderBottom: i < filtered.length - 1 ? "1px solid var(--border-sub)" : "none" }}>
              <div style={{ cursor: "pointer" }} onClick={() => setSelectedInvoice(inv)}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{tenant.name.split(" ").slice(0, 2).join(" ")}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{tenant.cpf}</div>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-sub)", cursor: "pointer" }} onClick={() => setSelectedInvoice(inv)}>{property.address.split("–")[0].trim()}</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 12.5, cursor: "pointer" }} onClick={() => setSelectedInvoice(inv)}>{fmtDate(inv.dueDate)}</div>
              <div onClick={() => setSelectedInvoice(inv)} style={{ cursor: "pointer" }}><StatusBadge status={inv.status} /></div>
              <div style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 12.5 }}>{brl(inv.baseValue)}</div>
              <div style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700, color: inv.status === "atrasado" ? "var(--red)" : "var(--text)" }}>
                {brl(inv.status === "atrasado" ? total : inv.baseValue)}
              </div>
              <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                <button className="icon-btn" title="Detalhes" onClick={() => setSelectedInvoice(inv)}><ArrowRight size={13} /></button>
                <button className="icon-btn danger" title="Excluir" onClick={() => setDeleteTarget(inv)}><Trash2 size={13} /></button>
              </div>
            </div>
          )
        })}
        {!filtered.length && <div className="empty-state"><Search size={28} />Nenhuma fatura encontrada.</div>}
      </div>

      {selectedInvoice && (
        <InvoiceDetailModal
          invoice={selectedInvoice}
          contract={contracts.find(c => c.id === selectedInvoice.contractId)!}
          tenant={tenants.find(t => t.id === selectedInvoice.tenantId)!}
          property={properties.find(p => p.id === selectedInvoice.propertyId)!}
          onClose={() => setSelectedInvoice(null)}
          onMarkPaid={() => handleMarkPaid(selectedInvoice)}
          addLog={addLog}
          addToast={addToast}
        />
      )}
      {deleteTarget && (
        <ConfirmModal
          title="Excluir fatura"
          message={`Deseja mover a fatura de ${tenants.find(t => t.id === deleteTarget.tenantId)?.name} para a lixeira?`}
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

function InvoiceDetailModal({ invoice, contract, tenant, property, onClose, onMarkPaid, addLog, addToast }: {
  invoice: Invoice; contract: Contract; tenant: Tenant; property: Property
  onClose: () => void; onMarkPaid: () => void
  addLog: (e: Omit<LogEntry, "id" | "at" | "by">) => void
  addToast: (m: string, t?: ToastItem["type"]) => void
}) {
  const days = invoice.status === "atrasado" ? daysDiff(invoice.dueDate) : 0
  const { fine, interest, total } = calcFine(invoice.baseValue, days, contract.fineRate, contract.interestRate)
  const isLate = invoice.status === "atrasado"

  const handleSend = () => {
    addLog({ action: "enviar", entityType: "Fatura", entityName: `Cobrança para ${tenant.name}` })
    addToast(`Cobrança enviada para ${tenant.name}`, "success")
    onClose()
  }

  return (
    <Modal onClose={onClose} title="Detalhe da Fatura" width={460}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ background: "var(--bg)", borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{tenant.name}</div>
          <div style={{ fontSize: 12.5, color: "var(--text-sub)" }}>{property.address}</div>
          <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <StatusBadge status={invoice.status} />
            {isLate && <span style={{ fontSize: 12, color: "var(--red)", fontWeight: 600 }}>{days} dias em atraso</span>}
            {invoice.paidDate && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Pago em {fmtDate(invoice.paidDate)}</span>}
          </div>
        </div>

        <div style={{ border: "1.5px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
          {[
            ["Valor base do aluguel", brl(invoice.baseValue), false],
            [`Multa contratual (${contract.fineRate}%)`, brl(fine), isLate],
            [`Juros (${contract.interestRate}% × ${Math.ceil(days / 30)} mês)`, brl(interest), isLate],
          ].map(([label, value, highlight], idx) => (
            <div key={idx} style={{ display: "flex", justifyContent: "space-between", padding: "11px 16px", borderBottom: "1px solid var(--border-sub)", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: highlight ? "var(--red)" : "var(--text-sub)" }}>{label as string}</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 600, color: highlight ? "var(--red)" : "var(--text)" }}>{value as string}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 16px", background: isLate ? "var(--red-dim)" : "var(--success-dim)", alignItems: "center" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: isLate ? "var(--red)" : "var(--success)" }}>Total a pagar</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 20, fontWeight: 800, color: isLate ? "var(--red)" : "var(--success)" }}>{brl(isLate ? total : invoice.baseValue)}</span>
          </div>
        </div>

        {invoice.status !== "pago" && (
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="success" style={{ flex: 1, justifyContent: "center" }} icon={<CircleCheck size={14} />} onClick={onMarkPaid}>Registrar Pagamento</Btn>
            <Btn variant="outline" icon={<Send size={14} />} onClick={handleSend}>Enviar Cobrança</Btn>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CAUÇÕES VIEW
// ═══════════════════════════════════════════════════════════════════════════════
type CaucaoStatus = "ativa" | "a_devolver" | "devolvida"

interface CaucaoReturn { contractId: string; returnedAt: string; note: string }

function CaucoesView({ contracts, tenants, properties, addLog, addToast }: {
  contracts: Contract[]; tenants: Tenant[]; properties: Property[]
  addLog: (e: Omit<LogEntry, "id" | "at" | "by">) => void
  addToast: (m: string, t?: ToastItem["type"]) => void
}) {
  const [returns, setReturns] = useState<CaucaoReturn[]>([])
  const [returnModal, setReturnModal] = useState<Contract | null>(null)
  const [filterStatus, setFilterStatus] = useState<CaucaoStatus | "todas">("todas")

  const caucaoContracts = contracts.filter(c => c.guarantee === "caucao")

  const getStatus = (c: Contract): CaucaoStatus => {
    if (returns.find(r => r.contractId === c.id)) return "devolvida"
    const daysToEnd = (new Date(c.endDate).getTime() - TODAY.getTime()) / 86400000
    if (daysToEnd <= 30) return "a_devolver"
    return "ativa"
  }

  const filtered = caucaoContracts.filter(c => filterStatus === "todas" || getStatus(c) === filterStatus)
  const totalDeposited = caucaoContracts.reduce((a, c) => a + (c.cautionValue || 0), 0)
  const totalToReturn = caucaoContracts.filter(c => getStatus(c) === "a_devolver").reduce((a, c) => a + (c.cautionValue || 0), 0)
  const totalReturned = caucaoContracts.filter(c => getStatus(c) === "devolvida").reduce((a, c) => a + (c.cautionValue || 0), 0)

  const statusInfo: Record<CaucaoStatus, { label: string; color: string; bg: string }> = {
    ativa:      { label: "Ativa",       color: "var(--info)",    bg: "var(--info-dim)" },
    a_devolver: { label: "A Devolver",  color: "var(--warning)", bg: "var(--warning-dim)" },
    devolvida:  { label: "Devolvida",   color: "var(--success)", bg: "var(--success-dim)" },
  }

  const handleReturn = (contractId: string, note: string) => {
    setReturns(prev => [...prev, { contractId, returnedAt: nowStr(), note }])
    const c = contracts.find(x => x.id === contractId)
    const t = tenants.find(x => x.id === c?.tenantId)
    addLog({ action: "editar", entityType: "Caução", entityName: `Devolução para ${t?.name}`, detail: `${brl(c?.cautionValue || 0)}` })
    addToast(`Devolução de ${t?.name.split(" ")[0]} registrada`, "success")
    setReturnModal(null)
  }

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 24 }}>
        {[
          { label: "Total Depositado", value: brl(totalDeposited), sub: `${caucaoContracts.length} depósitos`, color: "var(--navy)", bg: "var(--navy-dim)" },
          { label: "A Devolver",       value: brl(totalToReturn),  sub: "Contratos vencendo em 30 dias", color: "var(--warning)", bg: "var(--warning-dim)" },
          { label: "Já Devolvido",     value: brl(totalReturned),  sub: `${returns.length} devoluções registradas`, color: "var(--success)", bg: "var(--success-dim)" },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="stat-card">
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: "14px 14px 0 0" }} />
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 10 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.04em", lineHeight: 1, marginBottom: 4 }}>{value}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="filter-bar" style={{ marginBottom: 16 }}>
        {(["todas", "ativa", "a_devolver", "devolvida"] as const).map(s => (
          <button key={s} className={`filter-btn ${filterStatus === s ? "active" : ""}`} onClick={() => setFilterStatus(s)}>
            {s === "todas" ? "Todas" : statusInfo[s].label}
            <span className="filter-count">{s === "todas" ? caucaoContracts.length : caucaoContracts.filter(c => getStatus(c) === s).length}</span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card" style={{ overflow: "hidden", padding: 0 }}>
        <div className="table-head" style={{ gridTemplateColumns: "1.3fr 1.1fr 110px 110px 110px 100px 120px" }}>
          <span>Inquilino</span><span>Imóvel</span><span>Depósito</span><span>Início</span><span>Término</span><span>Status</span><span />
        </div>
        {filtered.map((c, i) => {
          const t = tenants.find(t => t.id === c.tenantId)!
          const p = properties.find(p => p.id === c.propertyId)!
          const st = getStatus(c)
          const ret = returns.find(r => r.contractId === c.id)
          const { label, color } = statusInfo[st]
          return (
            <div key={c.id} className="trow" style={{ gridTemplateColumns: "1.3fr 1.1fr 110px 110px 110px 100px 120px", borderBottom: i < filtered.length - 1 ? "1px solid var(--border-sub)" : "none" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name.split(" ").slice(0, 2).join(" ")}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t.cpf}</div>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-sub)" }}>{p.address.split("–")[0].trim()}</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700, color: "var(--navy)" }}>{brl(c.cautionValue || 0)}</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}>{fmtDate(c.startDate)}</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}>{fmtDate(c.endDate)}</div>
              <div>
                <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 9px", borderRadius: 99, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", background: statusInfo[st].bg, color }}>
                  {label}
                </span>
              </div>
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                {st === "devolvida" && ret && (
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {ret.returnedAt.split(" ")[0]}
                  </span>
                )}
                {st !== "devolvida" && (
                  <Btn size="sm" variant={st === "a_devolver" ? "danger" : "outline"} icon={<CircleCheck size={12} />}
                    onClick={() => setReturnModal(c)}>
                    Devolver
                  </Btn>
                )}
              </div>
            </div>
          )
        })}
        {!filtered.length && (
          <div className="empty-state">
            <Shield size={28} />Nenhuma caução encontrada.
          </div>
        )}
      </div>

      {returnModal && (
        <CaucaoReturnModal
          contract={returnModal}
          tenant={tenants.find(t => t.id === returnModal.tenantId)!}
          onClose={() => setReturnModal(null)}
          onConfirm={(note) => handleReturn(returnModal.id, note)}
        />
      )}
    </div>
  )
}

function CaucaoReturnModal({ contract, tenant, onClose, onConfirm }: {
  contract: Contract; tenant: Tenant; onClose: () => void; onConfirm: (note: string) => void
}) {
  const [note, setNote] = useState("")
  const [deductions, setDeductions] = useState("")
  const netReturn = (contract.cautionValue || 0) - (Number(deductions) || 0)

  return (
    <Modal onClose={onClose} title="Registrar Devolução de Caução" width={480}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Summary */}
        <div style={{ background: "var(--navy-dim)", borderRadius: 10, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{tenant.name}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Contrato até {fmtDate(contract.endDate)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 700 }}>Depósito</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "var(--navy)", fontFamily: "var(--mono)", letterSpacing: "-0.03em" }}>{brl(contract.cautionValue || 0)}</div>
          </div>
        </div>

        <Field label="Deduções (R$)">
          <Input type="number" step="0.01" placeholder="0,00 — deixe em branco se devolução integral" value={deductions} onChange={e => setDeductions(e.target.value)} />
        </Field>

        {Number(deductions) > 0 && (
          <div style={{ background: "var(--warning-dim)", borderRadius: 9, padding: "12px 14px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--warning)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>Resumo da devolução</div>
            {[
              ["Depósito original", brl(contract.cautionValue || 0)],
              ["Deduções", `- ${brl(Number(deductions))}`],
            ].map(([l, v]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: "1px solid rgba(217,119,6,0.15)" }}>
                <span style={{ color: "var(--text-sub)" }}>{l}</span><span style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{v}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700, paddingTop: 8, color: netReturn >= 0 ? "var(--success)" : "var(--red)" }}>
              <span>Valor líquido a devolver</span>
              <span style={{ fontFamily: "var(--mono)" }}>{brl(netReturn)}</span>
            </div>
          </div>
        )}

        <Field label="Observação">
          <Textarea placeholder="Ex: Devolução integral. Dedução de R$ 200 por reparo no box." value={note} onChange={e => setNote(e.target.value)} />
        </Field>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn variant="success" icon={<CircleCheck size={14} />} onClick={() => onConfirm(note)}>
            Confirmar Devolução — {brl(netReturn)}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CONTRATOS
// ═══════════════════════════════════════════════════════════════════════════════
type ContratosTab = "contratos" | "caucoes"

function Contratos({ contracts, tenants, properties, invoices, guarantors, addLog, addToast, setContracts, addToTrash, setProperties, setInvoices }: {
  contracts: Contract[]; tenants: Tenant[]; properties: Property[]; invoices: Invoice[]; guarantors: Guarantor[]
  addLog: (e: Omit<LogEntry, "id" | "at" | "by">) => void
  addToast: (m: string, t?: ToastItem["type"]) => void
  setContracts: React.Dispatch<React.SetStateAction<Contract[]>>
  addToTrash: (item: Omit<TrashItem, "id" | "deletedAt" | "deletedBy">) => void
  setProperties: React.Dispatch<React.SetStateAction<Property[]>>
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>
}) {
  const [tab, setTab] = useState<ContratosTab>("contratos")
  const [selected, setSelected] = useState<Contract | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Contract | null>(null)
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    if (!search) return contracts
    const s = search.toLowerCase()
    return contracts.filter(c => {
      const t = tenants.find(t => t.id === c.tenantId)
      const p = properties.find(p => p.id === c.propertyId)
      return t?.name.toLowerCase().includes(s) || p?.address.toLowerCase().includes(s)
    })
  }, [contracts, search, tenants, properties])

  const handleDelete = (c: Contract) => {
    const tenant = tenants.find(t => t.id === c.tenantId)
    addToTrash({ entityType: "contract", entityName: `Contrato ${tenant?.name}`, data: c })
    setContracts(prev => prev.filter(x => x.id !== c.id))
    setProperties(prev => prev.map(p => p.id === c.propertyId ? { ...p, status: "disponivel", contractId: undefined } : p))
    addLog({ action: "excluir", entityType: "Contrato", entityName: `Contrato ${tenant?.name}` })
    addToast("Contrato movido para a lixeira", "info")
    setDeleteTarget(null)
  }

  const handleExportWord = (c: Contract) => {
    const tenant = tenants.find(t => t.id === c.tenantId)!
    const property = properties.find(p => p.id === c.propertyId)!
    const guarantor = c.guarantorId ? guarantors.find(g => g.id === c.guarantorId) : undefined
    exportContractWord(c, tenant, property, guarantor)
    addLog({ action: "exportar", entityType: "Contrato", entityName: `Contrato ${tenant.name}`, detail: "Word" })
    addToast(`Contrato de ${tenant.name.split(" ")[0]} exportado`, "success")
  }

  return (
    <div>
      <PageHeader
        title={tab === "contratos" ? "Contratos" : "Gestão de Cauções"}
        sub={tab === "contratos" ? `${contracts.length} contratos ativos` : `${contracts.filter(c => c.guarantee === "caucao").length} depósitos registrados`}
        action={
          tab === "contratos" ? (
            <>
              <div style={{ position: "relative" }}>
                <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                <input className="search-input" style={{ paddingLeft: 30, width: 200 }} placeholder="Buscar…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <Btn icon={<Plus size={14} />} onClick={() => setShowNew(true)}>Novo Contrato</Btn>
            </>
          ) : undefined
        }
      />

      {/* Tab switcher */}
      <div className="filter-bar" style={{ marginBottom: 20, width: "fit-content" }}>
        <button className={`filter-btn ${tab === "contratos" ? "active" : ""}`} onClick={() => setTab("contratos")} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <FileText size={13} />Contratos <span className="filter-count">{contracts.length}</span>
        </button>
        <button className={`filter-btn ${tab === "caucoes" ? "active" : ""}`} onClick={() => setTab("caucoes")} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Shield size={13} />Cauções <span className="filter-count">{contracts.filter(c => c.guarantee === "caucao").length}</span>
        </button>
      </div>

      {tab === "caucoes" && (
        <CaucoesView contracts={contracts} tenants={tenants} properties={properties} addLog={addLog} addToast={addToast} />
      )}

      {tab === "contratos" && <div className="card" style={{ overflow: "hidden", padding: 0 }}>
        <div className="table-head" style={{ gridTemplateColumns: "1.4fr 1.2fr 110px 110px 100px 90px 100px" }}>
          <span>Inquilino</span><span>Imóvel</span><span>Início</span><span>Término</span>
          <span style={{ textAlign: "right" }}>Aluguel</span><span>Garantia</span><span />
        </div>
        {filtered.map((c, i) => {
          const t = tenants.find(t => t.id === c.tenantId)!
          const p = properties.find(p => p.id === c.propertyId)!
          const daysToEnd = Math.ceil((new Date(c.endDate).getTime() - TODAY.getTime()) / 86400000)
          const expiring = daysToEnd >= 0 && daysToEnd <= 60
          const guaranteeLabel = { caucao: "Caução", fiador: "Fiador", seguro: "Seguro" }[c.guarantee]
          return (
            <div key={c.id} className="trow" style={{ gridTemplateColumns: "1.4fr 1.2fr 110px 110px 100px 90px 100px", borderBottom: i < filtered.length - 1 ? "1px solid var(--border-sub)" : "none" }}>
              <div style={{ cursor: "pointer" }} onClick={() => setSelected(c)}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name.split(" ").slice(0, 2).join(" ")}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Venc. dia {c.dueDay}</div>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-sub)", cursor: "pointer" }} onClick={() => setSelected(c)}>{p.address.split("–")[0].trim()}</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}>{fmtDate(c.startDate)}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}>{fmtDate(c.endDate)}</span>
                {expiring && <span style={{ fontSize: 9, background: "var(--warning-dim)", color: "#92400e", padding: "1px 5px", borderRadius: 99, fontWeight: 700 }}>!</span>}
              </div>
              <div style={{ textAlign: "right", fontFamily: "var(--mono)", fontWeight: 700, fontSize: 13 }}>{brl(c.rentValue)}</div>
              <div>
                <span style={{ fontSize: 11, background: "var(--navy-dim)", color: "var(--navy)", padding: "3px 8px", borderRadius: 99, fontWeight: 600 }}>
                  {guaranteeLabel}
                </span>
              </div>
              <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                <button className="icon-btn" title="Ver detalhes" onClick={() => setSelected(c)}><Eye size={13} /></button>
                <button className="icon-btn" title="Exportar Word" onClick={() => handleExportWord(c)}><FilePen size={13} /></button>
                <button className="icon-btn danger" title="Excluir" onClick={() => setDeleteTarget(c)}><Trash2 size={13} /></button>
              </div>
            </div>
          )
        })}
        {!filtered.length && <div className="empty-state"><FileText size={28} />Nenhum contrato encontrado.</div>}
      </div>}

      {selected && (
        <ContractDetailModal
          contract={selected}
          tenant={tenants.find(t => t.id === selected.tenantId)!}
          property={properties.find(p => p.id === selected.propertyId)!}
          invoices={invoices.filter(i => i.contractId === selected.id)}
          guarantor={selected.guarantorId ? guarantors.find(g => g.id === selected.guarantorId) : undefined}
          onClose={() => setSelected(null)}
          onExportWord={() => handleExportWord(selected)}
        />
      )}
      {showNew && (
        <NewContractModal
          tenants={tenants}
          properties={properties.filter(p => p.status === "disponivel")}
          guarantors={guarantors}
          onClose={() => setShowNew(false)}
          onSave={(c) => {
            setContracts(prev => [...prev, c])
            setInvoices(prev => [...prev, ...generateInvoicesForContract(c)])
            setProperties(prev => prev.map(p => p.id === c.propertyId ? { ...p, status: "alugado", contractId: c.id } : p))
            addLog({ action: "criar", entityType: "Contrato", entityName: `Contrato ${tenants.find(t => t.id === c.tenantId)?.name}` })
            addToast("Contrato criado com sucesso", "success")
          }}
        />
      )}
      {deleteTarget && (
        <ConfirmModal
          title="Excluir contrato"
          message={`Deseja mover o contrato de ${tenants.find(t => t.id === deleteTarget.tenantId)?.name} para a lixeira? O imóvel voltará a ficar disponível.`}
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

function ContractDetailModal({ contract, tenant, property, invoices, guarantor, onClose, onExportWord }: {
  contract: Contract; tenant: Tenant; property: Property; invoices: Invoice[]; guarantor?: Guarantor; onClose: () => void; onExportWord: () => void
}) {
  return (
    <Modal onClose={onClose} title="Detalhes do Contrato" width={680}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12, gap: 8 }}>
        <Btn variant="outline" size="sm" icon={<FilePen size={13} />} onClick={onExportWord}>Exportar Word</Btn>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        {[
          ["Inquilino", tenant.name], ["Imóvel", property.address.split("–")[0].trim()],
          ["Início", fmtDate(contract.startDate)], ["Término", fmtDate(contract.endDate)],
          ["Aluguel mensal", brl(contract.rentValue)], ["Dia de vencimento", `Dia ${contract.dueDay}`],
          ["Multa", `${contract.fineRate}%`], ["Juros", `${contract.interestRate}% a.m.`],
        ].map(([l, v]) => (
          <div key={l} style={{ background: "var(--bg)", borderRadius: 9, padding: "10px 14px" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{l}</div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ background: "var(--navy-dim)", borderRadius: 10, padding: "12px 16px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
        <Shield size={16} style={{ color: "var(--navy)", flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--navy)" }}>
            Garantia: {contract.guarantee === "caucao" ? "Caução" : contract.guarantee === "fiador" ? "Fiador" : "Seguro Fiança"}
          </div>
          {contract.guarantee === "caucao" && <div style={{ fontSize: 12, color: "var(--text-sub)" }}>Valor: {brl(contract.cautionValue || 0)}</div>}
          {contract.guarantee === "fiador" && guarantor && <div style={{ fontSize: 12, color: "var(--text-sub)" }}>{guarantor.name} — {guarantor.cpf}</div>}
        </div>
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Histórico de Parcelas</div>
      <div style={{ border: "1.5px solid var(--border)", borderRadius: 10, overflow: "hidden", maxHeight: 240, overflowY: "auto" }}>
        {[...invoices].sort((a, b) => b.dueDate.localeCompare(a.dueDate)).map((inv, i) => {
          const days = inv.status === "atrasado" ? daysDiff(inv.dueDate) : 0
          const { total } = calcFine(inv.baseValue, days, contract.fineRate, contract.interestRate)
          return (
            <div key={inv.id} style={{ display: "grid", gridTemplateColumns: "110px 1fr 130px 100px", padding: "10px 14px", borderBottom: i < invoices.length - 1 ? "1px solid var(--border-sub)" : "none", alignItems: "center", fontSize: 12.5 }}>
              <span style={{ fontFamily: "var(--mono)" }}>{fmtDate(inv.dueDate)}</span>
              <StatusBadge status={inv.status} />
              <span style={{ fontFamily: "var(--mono)", textAlign: "right", fontWeight: 700, color: inv.status === "atrasado" ? "var(--red)" : "var(--text)" }}>
                {brl(inv.status === "atrasado" ? total : inv.baseValue)}
              </span>
              {inv.paidDate && <span style={{ fontFamily: "var(--mono)", textAlign: "right", color: "var(--text-muted)", fontSize: 11 }}>✓ {fmtDate(inv.paidDate)}</span>}
            </div>
          )
        })}
        {!invoices.length && <div className="empty-state" style={{ padding: "20px" }}>Nenhuma parcela gerada.</div>}
      </div>
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  NEW CONTRACT WIZARD
// ═══════════════════════════════════════════════════════════════════════════════
function NewContractModal({ tenants, properties, guarantors, onClose, onSave }: {
  tenants: Tenant[]; properties: Property[]; guarantors: Guarantor[]; onClose: () => void; onSave: (c: Contract) => void
}) {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({
    tenantId: "", propertyId: "", rentValue: "", dueDay: "5",
    startDate: "", endDate: "", guarantee: "caucao" as GuaranteeType,
    cautionValue: "", guarantorId: "", fineRate: "10", interestRate: "1",
  })
  const upd = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const steps = [
    { n: 1, label: "Inquilino & Imóvel" },
    { n: 2, label: "Valores" },
    { n: 3, label: "Garantia" },
    { n: 4, label: "Revisão" },
  ]

  const canNext = () => {
    if (step === 1) return form.tenantId && form.propertyId
    if (step === 2) return form.rentValue && form.startDate && form.endDate && Number(form.dueDay) >= 1 && Number(form.dueDay) <= 31
    if (step === 3) return form.guarantee === "seguro" || (form.guarantee === "caucao" && form.cautionValue) || (form.guarantee === "fiador" && form.guarantorId)
    return true
  }

  const handleSave = () => {
    const c: Contract = {
      id: "c" + genId(), tenantId: form.tenantId, propertyId: form.propertyId,
      startDate: form.startDate, endDate: form.endDate,
      rentValue: Number(form.rentValue), dueDay: Number(form.dueDay),
      guarantee: form.guarantee, cautionValue: form.cautionValue ? Number(form.cautionValue) : undefined,
      guarantorId: form.guarantorId || undefined, fineRate: Number(form.fineRate), interestRate: Number(form.interestRate),
    }
    onSave(c); onClose()
  }

  return (
    <Modal onClose={onClose} title="Novo Contrato" width={560}>
      {/* Step bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 28 }}>
        {steps.map((s, i) => (
          <div key={s.n} style={{ display: "flex", alignItems: "center", flex: i < steps.length - 1 ? 1 : "none" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div className="step-dot" style={{ background: step >= s.n ? "var(--navy)" : "var(--border)", color: step >= s.n ? "#fff" : "var(--text-muted)" }}>
                {step > s.n ? <CircleCheck size={14} /> : s.n}
              </div>
              <span style={{ fontSize: 10, fontWeight: 600, color: step >= s.n ? "var(--navy)" : "var(--text-muted)", whiteSpace: "nowrap" }}>{s.label}</span>
            </div>
            {i < steps.length - 1 && <div style={{ height: 2, flex: 1, background: step > s.n ? "var(--navy)" : "var(--border)", margin: "0 6px", marginBottom: 14 }} />}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Inquilino">
            <Sel value={form.tenantId} onChange={e => upd("tenantId", e.target.value)}>
              <option value="">Selecione…</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Sel>
          </Field>
          <Field label="Imóvel disponível">
            <Sel value={form.propertyId} onChange={e => upd("propertyId", e.target.value)}>
              <option value="">Selecione…</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.address}</option>)}
            </Sel>
          </Field>
        </div>
      )}

      {step === 2 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Valor do Aluguel (R$)">
            <Input type="number" placeholder="0,00" value={form.rentValue} onChange={e => upd("rentValue", e.target.value)} />
          </Field>
          <Field label="Dia de Vencimento">
            <Input type="number" min={1} max={31} placeholder="Ex: 15" value={form.dueDay} onChange={e => upd("dueDay", e.target.value)} />
          </Field>
          <Field label="Data de Início">
            <Input type="date" value={form.startDate} onChange={e => upd("startDate", e.target.value)} />
          </Field>
          <Field label="Data de Término">
            <Input type="date" value={form.endDate} onChange={e => upd("endDate", e.target.value)} />
          </Field>
          <Field label="Multa (%)">
            <Input type="number" value={form.fineRate} onChange={e => upd("fineRate", e.target.value)} />
          </Field>
          <Field label="Juros (% a.m.)">
            <Input type="number" step="0.1" value={form.interestRate} onChange={e => upd("interestRate", e.target.value)} />
          </Field>
        </div>
      )}

      {step === 3 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Tipo de Garantia">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {([["caucao", Shield, "Caução"], ["fiador", Users, "Fiador"], ["seguro", CheckCircle2, "Seguro Fiança"]] as [GuaranteeType, React.ElementType, string][]).map(([g, Icon, lbl]) => (
                <button key={g} onClick={() => upd("guarantee", g)}
                  style={{ padding: "14px 8px", borderRadius: 10, border: `2px solid ${form.guarantee === g ? "var(--navy)" : "var(--border)"}`, background: form.guarantee === g ? "var(--navy-dim)" : "#fff", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, fontFamily: "var(--font)", transition: "border-color 0.15s" }}>
                  <Icon size={20} style={{ color: form.guarantee === g ? "var(--navy)" : "var(--text-muted)" }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: form.guarantee === g ? "var(--navy)" : "var(--text-sub)" }}>{lbl}</span>
                </button>
              ))}
            </div>
          </Field>
          {form.guarantee === "caucao" && (
            <Field label="Valor da Caução (R$)">
              <Input type="number" placeholder="Ex: 9.600,00 (3 meses)" value={form.cautionValue} onChange={e => upd("cautionValue", e.target.value)} />
            </Field>
          )}
          {form.guarantee === "fiador" && (
            <Field label="Fiador">
              <Sel value={form.guarantorId} onChange={e => upd("guarantorId", e.target.value)}>
                <option value="">Selecione o fiador…</option>
                {guarantors.map(g => <option key={g.id} value={g.id}>{g.name} — {g.cpf}</option>)}
              </Sel>
            </Field>
          )}
          {form.guarantee === "seguro" && (
            <div style={{ background: "var(--info-dim)", borderRadius: 9, padding: "12px 14px", fontSize: 13, color: "var(--info)", display: "flex", gap: 8 }}>
              <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              O número da apólice será registrado após contratação da seguradora.
            </div>
          )}
        </div>
      )}

      {step === 4 && (
        <div>
          <div style={{ background: "var(--bg)", borderRadius: 10, padding: 16, marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Revisão do Contrato</div>
            {[
              ["Inquilino", tenants.find(t => t.id === form.tenantId)?.name || "—"],
              ["Imóvel", properties.find(p => p.id === form.propertyId)?.address.split("–")[0] || "—"],
              ["Aluguel", brl(Number(form.rentValue) || 0)],
              ["Vencimento", `Dia ${form.dueDay}`],
              ["Período", `${form.startDate ? fmtDate(form.startDate) : "—"} → ${form.endDate ? fmtDate(form.endDate) : "—"}`],
              ["Garantia", form.guarantee === "caucao" ? `Caução ${brl(Number(form.cautionValue) || 0)}` : form.guarantee === "fiador" ? `Fiador: ${guarantors.find(g => g.id === form.guarantorId)?.name || "—"}` : "Seguro Fiança"],
            ].map(([l, v]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--border-sub)", fontSize: 13 }}>
                <span style={{ color: "var(--text-muted)" }}>{l}</span><span style={{ fontWeight: 600 }}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{ background: "var(--success-dim)", borderRadius: 9, padding: "10px 14px", fontSize: 12.5, color: "var(--success)", display: "flex", alignItems: "center", gap: 7 }}>
            <CircleCheck size={14} /> As parcelas serão geradas automaticamente ao salvar.
          </div>
        </div>
      )}

      <div style={{ marginTop: 22, display: "flex", justifyContent: "space-between" }}>
        <Btn variant="ghost" onClick={() => step > 1 ? setStep(s => s - 1) : onClose()}>
          {step === 1 ? "Cancelar" : "← Voltar"}
        </Btn>
        <Btn onClick={() => { if (canNext()) step < 4 ? setStep(s => s + 1) : handleSave() }} style={{ opacity: canNext() ? 1 : 0.5 }}>
          {step === 4 ? "Salvar Contrato" : "Próximo →"}
        </Btn>
      </div>
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  IMÓVEIS
// ═══════════════════════════════════════════════════════════════════════════════
function Imoveis({ properties, contracts, tenants, setScreen, addLog, addToast, setProperties, addToTrash }: {
  properties: Property[]; contracts: Contract[]; tenants: Tenant[]
  setScreen: (s: Screen) => void; addLog: (e: Omit<LogEntry, "id" | "at" | "by">) => void
  addToast: (m: string, t?: ToastItem["type"]) => void
  setProperties: React.Dispatch<React.SetStateAction<Property[]>>
  addToTrash: (item: Omit<TrashItem, "id" | "deletedAt" | "deletedBy">) => void
}) {
  const [filter, setFilter] = useState<PropertyStatus | "todos">("todos")
  const [showNew, setShowNew] = useState(false)
  const [editTarget, setEditTarget] = useState<Property | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Property | null>(null)
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    let list = filter === "todos" ? properties : properties.filter(p => p.status === filter)
    if (search) list = list.filter(p => p.address.toLowerCase().includes(search.toLowerCase()) || p.type.toLowerCase().includes(search.toLowerCase()))
    return list
  }, [properties, filter, search])

  const counts = {
    disponivel: properties.filter(p => p.status === "disponivel").length,
    alugado: properties.filter(p => p.status === "alugado").length,
    manutencao: properties.filter(p => p.status === "manutencao").length,
  }

  const handleSaveNew = (p: Property) => {
    setProperties(prev => [...prev, p])
    addLog({ action: "criar", entityType: "Imóvel", entityName: p.address })
    addToast("Imóvel cadastrado com sucesso", "success")
  }

  const handleEdit = (p: Property) => {
    setProperties(prev => prev.map(x => x.id === p.id ? p : x))
    addLog({ action: "editar", entityType: "Imóvel", entityName: p.address })
    addToast("Imóvel atualizado", "success")
    setEditTarget(null)
  }

  const handleDelete = (p: Property) => {
    if (p.status === "alugado") { addToast("Não é possível excluir um imóvel alugado.", "error"); return }
    addToTrash({ entityType: "property", entityName: p.address, data: p })
    setProperties(prev => prev.filter(x => x.id !== p.id))
    addLog({ action: "excluir", entityType: "Imóvel", entityName: p.address })
    addToast("Imóvel movido para a lixeira", "info")
    setDeleteTarget(null)
  }

  return (
    <div>
      <PageHeader title="Imóveis" sub={`${properties.length} imóveis cadastrados`}
        action={
          <>
            <div style={{ position: "relative" }}>
              <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
              <input className="search-input" style={{ paddingLeft: 30, width: 200 }} placeholder="Buscar…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Btn icon={<Plus size={14} />} onClick={() => setShowNew(true)}>Cadastrar Imóvel</Btn>
          </>
        }
      />

      <div className="summary-cards" style={{ marginBottom: 20 }}>
        {([["disponivel", "Disponíveis", counts.disponivel, "var(--success)", "var(--success-dim)"],
           ["alugado",    "Alugados",    counts.alugado,    "var(--info)",    "var(--info-dim)"],
           ["manutencao", "Manutenção",  counts.manutencao, "var(--warning)", "var(--warning-dim)"]] as const).map(([s, l, n, c, bg]) => (
          <div key={s} className="stat-card" style={{ cursor: "pointer", border: `1.5px solid ${filter === s ? c : "var(--border)"}` }}
            onClick={() => setFilter(filter === s ? "todos" : s)}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Home size={18} style={{ color: c }} />
              </div>
              <div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", lineHeight: 1, letterSpacing: "-0.04em" }}>{n}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{l}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
        {filtered.map(prop => {
          const contract = prop.contractId ? contracts.find(c => c.id === prop.contractId) : undefined
          const tenant = contract ? tenants.find(t => t.id === contract.tenantId) : undefined
          return (
            <div key={prop.id} className="property-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: "var(--navy-dim)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Building2 size={17} style={{ color: "var(--navy)" }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <StatusBadge status={prop.status} />
                  <button className="icon-btn" onClick={() => setEditTarget(prop)} title="Editar"><Edit2 size={12} /></button>
                  {prop.status !== "alugado" && <button className="icon-btn danger" onClick={() => setDeleteTarget(prop)} title="Excluir"><Trash2 size={12} /></button>}
                </div>
              </div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3, lineHeight: 1.3 }}>{prop.address.split("–")[0].trim()}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: prop.owner ? 4 : 0 }}>{prop.type}</div>
              {prop.owner && <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 8 }}>Proprietário: <span style={{ color: "var(--text-sub)", fontWeight: 500 }}>{prop.owner}</span></div>}
              {tenant && contract && (
                <div style={{ borderTop: "1px solid var(--border-sub)", paddingTop: 10, marginTop: 4 }}>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 3 }}>Inquilino atual</div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{tenant.name.split(" ").slice(0, 2).join(" ")}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
                    <span>Até {fmtDate(contract.endDate)}</span>
                    <span style={{ fontFamily: "var(--mono)", fontWeight: 700, color: "var(--navy)" }}>{brl(contract.rentValue)}/mês</span>
                  </div>
                  <button onClick={() => setScreen("contratos")} className="link-btn" style={{ marginTop: 8, padding: 0 }}>
                    Ver contrato <ChevronRight size={12} />
                  </button>
                </div>
              )}
            </div>
          )
        })}
        {!filtered.length && (
          <div className="empty-state" style={{ gridColumn: "1 / -1" }}>
            <Building2 size={28} />Nenhum imóvel encontrado.
          </div>
        )}
      </div>

      {showNew && <PropertyFormModal onClose={() => setShowNew(false)} onSave={handleSaveNew} title="Cadastrar Imóvel" />}
      {editTarget && <PropertyFormModal initial={editTarget} onClose={() => setEditTarget(null)} onSave={handleEdit} title="Editar Imóvel" />}
      {deleteTarget && (
        <ConfirmModal
          title="Excluir imóvel"
          message={`Deseja mover "${deleteTarget.address.split("–")[0].trim()}" para a lixeira?`}
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

function PropertyFormModal({ initial, onClose, onSave, title }: {
  initial?: Property; onClose: () => void; onSave: (p: Property) => void; title: string
}) {
  const [form, setForm] = useState<Omit<Property, "id"> & { id?: string }>({
    id: initial?.id, address: initial?.address || "", type: initial?.type || "Apartamento 2 quartos",
    status: initial?.status || "disponivel", contractId: initial?.contractId, owner: initial?.owner || "",
  })
  const upd = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = () => {
    if (!form.address) return
    onSave({ ...form, id: form.id || "p" + genId() } as Property)
    onClose()
  }

  return (
    <Modal onClose={onClose} title={title} width={480}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Endereço completo">
          <Input placeholder="Ex: Rua das Flores, 123 – Ap. 42 – Bairro" value={form.address} onChange={e => upd("address", e.target.value)} />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Tipo de imóvel">
            <Sel value={form.type} onChange={e => upd("type", e.target.value)}>
              {["Apartamento 1 quarto", "Apartamento 2 quartos", "Apartamento 3 quartos", "Casa 2 quartos", "Casa 3 quartos", "Sala comercial", "Galpão"].map(t => <option key={t}>{t}</option>)}
            </Sel>
          </Field>
          <Field label="Status">
            <Sel value={form.status} onChange={e => upd("status", e.target.value)}>
              <option value="disponivel">Disponível</option>
              <option value="alugado">Alugado</option>
              <option value="manutencao">Manutenção</option>
            </Sel>
          </Field>
        </div>
        <Field label="Proprietário">
          <Input placeholder="Nome do proprietário" value={form.owner || ""} onChange={e => upd("owner", e.target.value)} />
        </Field>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={handleSave} icon={<CircleCheck size={14} />}>Salvar</Btn>
        </div>
      </div>
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CADASTROS
// ═══════════════════════════════════════════════════════════════════════════════
type CadTab = "inquilinos" | "fiadores"

function Cadastros({ tenants, guarantors, contracts, properties, addLog, addToast, setTenants, setGuarantors, addToTrash, invoices }: {
  tenants: Tenant[]; guarantors: Guarantor[]; contracts: Contract[]; properties: Property[]
  addLog: (e: Omit<LogEntry, "id" | "at" | "by">) => void
  addToast: (m: string, t?: ToastItem["type"]) => void
  setTenants: React.Dispatch<React.SetStateAction<Tenant[]>>
  setGuarantors: React.Dispatch<React.SetStateAction<Guarantor[]>>
  addToTrash: (item: Omit<TrashItem, "id" | "deletedAt" | "deletedBy">) => void
  invoices: Invoice[]
}) {
  const [cadTab, setCadTab] = useState<CadTab>("inquilinos")
  const [showNewTenant, setShowNewTenant] = useState(false)
  const [showNewGuarantor, setShowNewGuarantor] = useState(false)
  const [editTenant, setEditTenant] = useState<Tenant | null>(null)
  const [editGuarantor, setEditGuarantor] = useState<Guarantor | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ type: "tenant" | "guarantor"; data: Tenant | Guarantor } | null>(null)
  const [search, setSearch] = useState("")

  const filteredTenants = useMemo(() => {
    if (!search) return tenants
    const s = search.toLowerCase()
    return tenants.filter(t => t.name.toLowerCase().includes(s) || t.cpf.includes(s) || t.email.toLowerCase().includes(s))
  }, [tenants, search])

  const filteredGuarantors = useMemo(() => {
    if (!search) return guarantors
    const s = search.toLowerCase()
    return guarantors.filter(g => g.name.toLowerCase().includes(s) || g.cpf.includes(s))
  }, [guarantors, search])

  const handleSaveTenant = (t: Tenant) => {
    if (editTenant) {
      setTenants(prev => prev.map(x => x.id === t.id ? t : x))
      addLog({ action: "editar", entityType: "Inquilino", entityName: t.name })
      addToast("Inquilino atualizado", "success")
      setEditTenant(null)
    } else {
      setTenants(prev => [...prev, t])
      addLog({ action: "criar", entityType: "Inquilino", entityName: t.name })
      addToast("Inquilino cadastrado", "success")
      setShowNewTenant(false)
    }
  }

  const handleSaveGuarantor = (g: Guarantor) => {
    if (editGuarantor) {
      setGuarantors(prev => prev.map(x => x.id === g.id ? g : x))
      addLog({ action: "editar", entityType: "Fiador", entityName: g.name })
      addToast("Fiador atualizado", "success")
      setEditGuarantor(null)
    } else {
      setGuarantors(prev => [...prev, g])
      addLog({ action: "criar", entityType: "Fiador", entityName: g.name })
      addToast("Fiador cadastrado", "success")
      setShowNewGuarantor(false)
    }
  }

  const handleDelete = () => {
    if (!deleteTarget) return
    const { type, data } = deleteTarget
    if (type === "tenant") {
      addToTrash({ entityType: "tenant", entityName: (data as Tenant).name, data })
      setTenants(prev => prev.filter(t => t.id !== data.id))
      addLog({ action: "excluir", entityType: "Inquilino", entityName: data.name })
    } else {
      addToTrash({ entityType: "guarantor", entityName: (data as Guarantor).name, data })
      setGuarantors(prev => prev.filter(g => g.id !== data.id))
      addLog({ action: "excluir", entityType: "Fiador", entityName: data.name })
    }
    addToast("Movido para a lixeira", "info")
    setDeleteTarget(null)
  }

  const handleExportTenants = () => {
    exportCSV(
      ["Nome", "CPF", "Telefone", "E-mail", "Imóvel", "Aluguel"],
      filteredTenants.map(t => {
        const c = contracts.find(x => x.tenantId === t.id)
        const p = c ? properties.find(x => x.id === c.propertyId) : undefined
        return [t.name, t.cpf, t.phone, t.email, p?.address || "—", c ? brl(c.rentValue) : "—"]
      }),
      "inquilinos-bs-imobiliaria.csv"
    )
    addLog({ action: "exportar", entityType: "Cadastros", entityName: "Lista de Inquilinos" })
    addToast("Exportado para Excel", "success")
  }

  return (
    <div>
      <PageHeader title="Cadastros" sub="Inquilinos e fiadores"
        action={
          <>
            <div style={{ position: "relative" }}>
              <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
              <input className="search-input" style={{ paddingLeft: 30, width: 180 }} placeholder="Buscar…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            {cadTab === "inquilinos" && <Btn variant="outline" size="sm" icon={<FileSpreadsheet size={13} />} onClick={handleExportTenants}>Exportar</Btn>}
            <Btn icon={<Plus size={14} />} onClick={() => cadTab === "inquilinos" ? setShowNewTenant(true) : setShowNewGuarantor(true)}>
              {cadTab === "inquilinos" ? "Novo Inquilino" : "Novo Fiador"}
            </Btn>
          </>
        }
      />

      <div className="filter-bar" style={{ marginBottom: 20, width: "fit-content" }}>
        {([["inquilinos", "Inquilinos", Users], ["fiadores", "Fiadores", Shield]] as const).map(([id, l, Icon]) => (
          <button key={id} onClick={() => { setCadTab(id); setSearch("") }} className={`filter-btn ${cadTab === id ? "active" : ""}`} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Icon size={13} />{l} <span className="filter-count">{id === "inquilinos" ? tenants.length : guarantors.length}</span>
          </button>
        ))}
      </div>

      {cadTab === "inquilinos" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filteredTenants.map(t => {
            const contract = contracts.find(c => c.tenantId === t.id)
            const property = contract ? properties.find(p => p.id === contract.propertyId) : undefined
            const lateCount = invoices.filter(i => i.tenantId === t.id && i.status === "atrasado").length
            return (
              <div key={t.id} className="person-card">
                <div className="person-avatar" style={{ background: "var(--navy)" }}>{initials(t.name)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 1 }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.cpf} · {t.phone}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.email}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {property && contract ? (
                    <>
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 2 }}>Imóvel atual</div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{property.address.split("–")[0].trim()}</div>
                      <div style={{ fontSize: 12, color: "var(--navy)", fontFamily: "var(--mono)", fontWeight: 600 }}>{brl(contract.rentValue)}/mês</div>
                    </>
                  ) : (
                    <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Sem imóvel vinculado</div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  {lateCount > 0 && <span className="days-badge">{lateCount} atraso{lateCount > 1 ? "s" : ""}</span>}
                  <button className="icon-btn" title="Editar" onClick={() => setEditTenant(t)}><Edit2 size={13} /></button>
                  <button className="icon-btn danger" title="Excluir" onClick={() => setDeleteTarget({ type: "tenant", data: t })}><Trash2 size={13} /></button>
                </div>
              </div>
            )
          })}
          {!filteredTenants.length && <div className="empty-state"><Users size={28} />Nenhum inquilino encontrado.</div>}
        </div>
      )}

      {cadTab === "fiadores" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filteredGuarantors.map(g => {
            const linkedContracts = contracts.filter(c => g.contractIds.includes(c.id))
            return (
              <div key={g.id} className="card" style={{ padding: "16px 20px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: linkedContracts.length > 0 ? 14 : 0 }}>
                  <div className="person-avatar" style={{ background: "var(--navy-light)", flexShrink: 0 }}>{initials(g.name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{g.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{g.cpf} · {g.phone}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{g.email}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ background: "var(--navy-dim)", color: "var(--navy)", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 99 }}>
                      {linkedContracts.length} contrato{linkedContracts.length !== 1 ? "s" : ""}
                    </span>
                    <button className="icon-btn" title="Editar" onClick={() => setEditGuarantor(g)}><Edit2 size={13} /></button>
                    <button className="icon-btn danger" title="Excluir" onClick={() => setDeleteTarget({ type: "guarantor", data: g })}><Trash2 size={13} /></button>
                  </div>
                </div>
                {linkedContracts.length > 0 && (
                  <div style={{ borderTop: "1px solid var(--border-sub)", paddingTop: 12 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Garantidor dos contratos</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {linkedContracts.map(c => {
                        const t = tenants.find(t => t.id === c.tenantId)!
                        const p = properties.find(p => p.id === c.propertyId)!
                        return (
                          <div key={c.id} style={{ background: "var(--bg)", borderRadius: 9, padding: "8px 12px", border: "1px solid var(--border)" }}>
                            <div style={{ fontSize: 12, fontWeight: 600 }}>{t?.name.split(" ").slice(0, 2).join(" ")}</div>
                            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{p?.address.split("–")[0].trim()}</div>
                            <div style={{ fontSize: 11.5, color: "var(--navy)", fontFamily: "var(--mono)", fontWeight: 600, marginTop: 2 }}>{brl(c.rentValue)}/mês</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          {!filteredGuarantors.length && <div className="empty-state"><Shield size={28} />Nenhum fiador encontrado.</div>}
        </div>
      )}

      {(showNewTenant || editTenant) && (
        <PersonFormModal
          title={editTenant ? "Editar Inquilino" : "Novo Inquilino"}
          initial={editTenant || undefined}
          onClose={() => { setShowNewTenant(false); setEditTenant(null) }}
          onSave={handleSaveTenant}
          type="tenant"
        />
      )}
      {(showNewGuarantor || editGuarantor) && (
        <PersonFormModal
          title={editGuarantor ? "Editar Fiador" : "Novo Fiador"}
          initial={editGuarantor || undefined}
          onClose={() => { setShowNewGuarantor(false); setEditGuarantor(null) }}
          onSave={handleSaveGuarantor}
          type="guarantor"
        />
      )}
      {deleteTarget && (
        <ConfirmModal
          title={`Excluir ${deleteTarget.type === "tenant" ? "inquilino" : "fiador"}`}
          message={`Deseja mover "${deleteTarget.data.name}" para a lixeira? Esta ação pode ser desfeita.`}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

function PersonFormModal({ title, initial, onClose, onSave, type }: {
  title: string; initial?: Tenant | Guarantor; onClose: () => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSave: (data: any) => void; type: "tenant" | "guarantor"
}) {
  const [form, setForm] = useState({
    name: initial?.name || "", cpf: initial?.cpf || "", phone: initial?.phone || "", email: (initial as any)?.email || "",
  })
  const upd = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = () => {
    if (!form.name || !form.cpf) return
    if (type === "tenant") {
      onSave({ id: (initial as Tenant)?.id || "t" + genId(), ...form, propertyId: (initial as Tenant)?.propertyId } as Tenant)
    } else {
      onSave({ id: (initial as Guarantor)?.id || "g" + genId(), ...form, contractIds: (initial as Guarantor)?.contractIds || [] } as Guarantor)
    }
    onClose()
  }

  return (
    <Modal onClose={onClose} title={title} width={460}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Nome completo *">
          <Input placeholder="Nome completo" value={form.name} onChange={e => upd("name", e.target.value)} />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="CPF *">
            <Input placeholder="000.000.000-00" value={form.cpf} onChange={e => upd("cpf", e.target.value)} />
          </Field>
          <Field label="Telefone">
            <Input placeholder="(11) 99999-0000" value={form.phone} onChange={e => upd("phone", e.target.value)} />
          </Field>
        </div>
        <Field label="E-mail">
          <Input type="email" placeholder="email@exemplo.com" value={form.email} onChange={e => upd("email", e.target.value)} />
        </Field>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={handleSave} icon={<CircleCheck size={14} />}>Salvar</Btn>
        </div>
      </div>
    </Modal>
  )
}

// ─── MANUAL PAYMENT MODAL ─────────────────────────────────────────────────────
function ManualPaymentModal({ invoices, tenants, onClose, addLog, addToast }: {
  invoices: Invoice[]; tenants: Tenant[]; onClose: () => void
  addLog: (e: Omit<LogEntry, "id" | "at" | "by">) => void
  addToast: (m: string, t?: ToastItem["type"]) => void
}) {
  const [selectedId, setSelectedId] = useState("")
  const [payDate, setPayDate] = useState(TODAY.toISOString().slice(0, 10))
  const [note, setNote] = useState("")
  const [done, setDone] = useState(false)

  const handleSave = () => {
    if (!selectedId) return
    const inv = invoices.find(i => i.id === selectedId)
    const tenant = tenants.find(t => t.id === inv?.tenantId)
    addLog({ action: "pagar", entityType: "Fatura", entityName: `${tenant?.name} · ${inv ? fmtDate(inv.dueDate) : ""}`, detail: note || undefined })
    addToast(`Pagamento de ${tenant?.name} registrado`, "success")
    setDone(true)
  }

  return (
    <Modal onClose={onClose} title="Baixa Manual de Pagamento">
      {!done ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "var(--warning-dim)", borderRadius: 9, padding: "10px 14px", fontSize: 12.5, color: "#92400e", display: "flex", alignItems: "center", gap: 7 }}>
            <AlertTriangle size={14} style={{ color: "var(--warning)", flexShrink: 0 }} />
            Use apenas para pagamentos em dinheiro ou depósito direto sem comprovante digital.
          </div>
          <Field label="Fatura">
            <Sel value={selectedId} onChange={e => setSelectedId(e.target.value)}>
              <option value="">Selecione a fatura…</option>
              {invoices.map(i => {
                const t = tenants.find(t => t.id === i.tenantId)!
                return <option key={i.id} value={i.id}>{t.name} — {fmtDate(i.dueDate)} — {brl(i.baseValue)}</option>
              })}
            </Sel>
          </Field>
          <Field label="Data do Pagamento">
            <Input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} />
          </Field>
          <Field label="Observação">
            <Textarea placeholder="Ex: Pago em dinheiro na imobiliária" value={note} onChange={e => setNote(e.target.value)} />
          </Field>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
            <Btn variant="success" onClick={handleSave} icon={<CircleCheck size={14} />}>Confirmar Baixa</Btn>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "24px 0" }}>
          <div style={{ width: 60, height: 60, borderRadius: "50%", background: "var(--success-dim)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <CircleCheck size={30} style={{ color: "var(--success)" }} />
          </div>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Pagamento registrado!</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 24 }}>Fatura marcada como paga em {fmtDate(payDate)}.</div>
          <Btn onClick={onClose} style={{ margin: "0 auto" }}>Fechar</Btn>
        </div>
      )}
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  APP ROOT
// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [screen, setScreen] = useState<Screen>("dashboard")
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      setAuthLoading(false)
    })
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })
    return () => { mounted = false; subscription.subscription.unsubscribe() }
  }, [])

  const currentUser: AppUser | null = session?.user ? {
    id: session.user.id,
    name: session.user.user_metadata?.name || session.user.email?.split("@")[0] || "Usuário",
    email: session.user.email || "",
    role: session.user.user_metadata?.role || "Administrador",
  } : null

  const [invoices, setInvoices] = useState<Invoice[]>(SEED_INVOICES)
  const [contracts, setContracts] = useState<Contract[]>(SEED_CONTRACTS)
  const [tenants, setTenants] = useState<Tenant[]>(SEED_TENANTS)
  const [properties, setProperties] = useState<Property[]>(SEED_PROPERTIES)
  const [guarantors, setGuarantors] = useState<Guarantor[]>(SEED_GUARANTORS)

  const [trash, setTrash] = useState<TrashItem[]>([])
  const [log, setLog] = useState<LogEntry[]>([])
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const [showTrash, setShowTrash] = useState(false)
  const [showLog, setShowLog] = useState(false)

  const addToast = useCallback((message: string, type: ToastItem["type"] = "success") => {
    const id = genId()
    setToasts(t => [...t, { id, message, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3800)
  }, [])

  const addLog = useCallback((entry: Omit<LogEntry, "id" | "at" | "by">) => {
    setLog(prev => [...prev, { ...entry, id: genId(), at: nowStr(), by: currentUser?.name || "Sistema" }])
  }, [currentUser])

  const addToTrash = useCallback((item: Omit<TrashItem, "id" | "deletedAt" | "deletedBy">) => {
    setTrash(prev => [...prev, { ...item, id: genId(), deletedAt: nowStr(), deletedBy: currentUser?.name || "Sistema" }])
  }, [currentUser])

  const handleLogin = async (email: string, password: string): Promise<{ error?: string }> => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: "E-mail ou senha inválidos." }
    const name = data.user?.user_metadata?.name || data.user?.email?.split("@")[0] || "Usuário"
    addToast(`Bem-vindo, ${name.split(" ")[0]}!`, "success")
    return {}
  }

  const handleRegister = async (name: string, email: string, password: string, role: string): Promise<{ error?: string }> => {
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { name, role } } })
    if (error) return { error: error.message }
    return {}
  }

  const handleForgot = async (email: string): Promise<{ error?: string }> => {
    const { error } = await supabase.auth.resetPasswordForEmail(email)
    if (error) return { error: error.message }
    return {}
  }

  const handleLogout = async () => {
    addLog({ action: "login", entityType: "Usuário", entityName: `${currentUser?.name} saiu` })
    await supabase.auth.signOut()
    setScreen("dashboard")
    setSidebarOpen(false)
  }

  const handleRestoreTrash = (item: TrashItem) => {
    // Re-add to correct state
    if (item.entityType === "tenant") setTenants(prev => [...prev, item.data as Tenant])
    if (item.entityType === "guarantor") setGuarantors(prev => [...prev, item.data as Guarantor])
    if (item.entityType === "property") setProperties(prev => [...prev, item.data as Property])
    if (item.entityType === "contract") setContracts(prev => [...prev, item.data as Contract])
    if (item.entityType === "invoice") setInvoices(prev => [...prev, item.data as Invoice])
    setTrash(prev => prev.filter(t => t.id !== item.id))
    addLog({ action: "restaurar", entityType: item.entityType, entityName: item.entityName })
    addToast(`${item.entityName} restaurado`, "success")
  }

  const handleDeleteTrash = (id: string) => {
    setTrash(prev => prev.filter(t => t.id !== id))
    addToast("Excluído permanentemente", "info")
  }

  const commonProps = { addLog, addToast, user: currentUser! }

  if (authLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--navy)" }}>
        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 14 }}>Carregando…</div>
      </div>
    )
  }

  if (!currentUser) {
    return (
      <>
        <LoginScreen onLogin={handleLogin} onRegister={handleRegister} onForgot={handleForgot} />
        <Toasts toasts={toasts} />
      </>
    )
  }

  return (
    <div className="app-root">
      <Sidebar
        screen={screen}
        setScreen={setScreen}
        user={currentUser}
        onLogout={handleLogout}
        trashCount={trash.length}
        onTrash={() => setShowTrash(true)}
        logCount={log.length}
        onLog={() => setShowLog(true)}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="app-body">
        {/* Top bar */}
        <div className="topbar">
          <button className="hamburger" onClick={() => setSidebarOpen(true)}>
            <Menu size={20} />
          </button>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="topbar-btn" onClick={() => setShowLog(true)} title="Log de atividades">
              <Activity size={15} />
              {log.length > 0 && <span className="topbar-badge">{Math.min(log.length, 99)}</span>}
            </button>
            <button className="topbar-btn" onClick={() => setShowTrash(true)} title="Lixeira">
              <Trash2 size={15} />
              {trash.length > 0 && <span className="topbar-badge" style={{ background: "var(--red)" }}>{trash.length}</span>}
            </button>
            <div className="topbar-user">
              <div className="topbar-avatar">{initials(currentUser.name)}</div>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{currentUser.name.split(" ")[0]}</span>
            </div>
          </div>
        </div>

        <main className="main-content">
          {screen === "dashboard" && (
            <Dashboard
              invoices={invoices} contracts={contracts} tenants={tenants} properties={properties}
              setScreen={setScreen} {...commonProps}
            />
          )}
          {screen === "financeiro" && (
            <Financeiro
              invoices={invoices} contracts={contracts} tenants={tenants} properties={properties}
              setInvoices={setInvoices} addToTrash={addToTrash} {...commonProps}
            />
          )}
          {screen === "contratos" && (
            <Contratos
              contracts={contracts} tenants={tenants} properties={properties} invoices={invoices} guarantors={guarantors}
              setContracts={setContracts} setProperties={setProperties} setInvoices={setInvoices} addToTrash={addToTrash} {...commonProps}
            />
          )}
          {screen === "imoveis" && (
            <Imoveis
              properties={properties} contracts={contracts} tenants={tenants}
              setScreen={setScreen} setProperties={setProperties} addToTrash={addToTrash} {...commonProps}
            />
          )}
          {screen === "cadastros" && (
            <Cadastros
              tenants={tenants} guarantors={guarantors} contracts={contracts} properties={properties}
              invoices={invoices} setTenants={setTenants} setGuarantors={setGuarantors} addToTrash={addToTrash} {...commonProps}
            />
          )}
        </main>
      </div>

      {showTrash && <TrashModal items={trash} onRestore={handleRestoreTrash} onDelete={handleDeleteTrash} onClose={() => setShowTrash(false)} />}
      {showLog && <LogModal entries={log} onClose={() => setShowLog(false)} />}
      <Toasts toasts={toasts} />
    </div>
  )
}
