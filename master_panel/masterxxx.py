#!/usr/bin/env python3
import threading
from datetime import datetime
try:
    import customtkinter as ctk
    HAS_CTK = True
except ImportError:
    import tkinter as tk, tkinter.ttk as ttk
    HAS_CTK = False
try:
    import requests
except ImportError:
    raise SystemExit("pip install requests customtkinter")

API_BASE = "http://192.168.1.92:5000/api"

class APIClient:
    def __init__(self):
        self.token = None
        self.s = requests.Session()
        self.s.timeout = 10
    def _h(self, tok=None):
        t = tok or self.token
        h = {"Content-Type": "application/json"}
        if t: h["Authorization"] = "Bearer " + t
        return h
    def login(self, u, p):
        r = self.s.post(API_BASE+"/auth/login",json={"email":u,"password":p},headers=self._h()).json()
        if r.get("success") and r["data"]["user"]["role"]=="MASTER":
            self.token = r["data"]["token"]; return {"success": True}
        return {"success": False, "message": r.get("message","Not master")}
    def get_tenants(self): return self.s.get(API_BASE+"/master/tenants",headers=self._h()).json().get("data",[])
    def get_stats(self):
        rows=self.s.get(API_BASE+"/master/stats",headers=self._h()).json().get("data",[])
        return {r["tenantId"]:r for r in rows}
    def get_quota(self, tid):
        try: return self.s.get(API_BASE+"/master/mcp-quota/"+tid,headers=self._h()).json().get("data",{"used":0,"limit":1})
        except: return {"used":0,"limit":1}
    def set_quota(self, tid, limit):
        return self.s.patch(API_BASE+"/master/tenant/"+tid+"/quota",json={"mcpUserLimit":limit},headers=self._h()).json()
    def switch_tenant(self, tid):
        return self.s.post(API_BASE+"/master/switch-tenant",json={"tenantId":tid},headers=self._h()).json()
    def trigger_backup(self, tid):
        res=self.switch_tenant(tid); tok=(res.get("data") or {}).get("token") or self.token
        return self.s.post(API_BASE+"/backup/trigger",headers=self._h(tok)).json()

api = APIClient()

def fmt(iso):
    if not iso: return "-"
    try: return datetime.fromisoformat(iso.replace("Z","+00:00")).strftime("%d/%m/%y %H:%M")
    except: return str(iso)[:16]

def main():
    if HAS_CTK: _ctk()
    else: _tk()

def _tk():
    root=tk.Tk(); root.title("Phopy Master Panel"); root.geometry("800x540")
    frm=tk.Frame(root); frm.pack(expand=True,fill="both",padx=36,pady=36)
    tk.Label(frm,text="Phopy Master Panel",font=("",18,"bold")).pack()
    lf=tk.LabelFrame(frm,text=" Login "); lf.pack(fill="x",pady=6)
    uv,pv=tk.StringVar(),tk.StringVar()
    tk.Label(lf,text="Username").grid(row=0,column=0,padx=12,pady=7,sticky="w")
    ue=tk.Entry(lf,textvariable=uv,width=28); ue.grid(row=0,column=1,pady=7); ue.focus()
    tk.Label(lf,text="Password").grid(row=1,column=0,padx=12,pady=7,sticky="w")
    tk.Entry(lf,textvariable=pv,show="*",width=28).grid(row=1,column=1,pady=7)
    st=tk.StringVar(); tk.Label(frm,textvariable=st,fg="red").pack()
    cols=("tenant","users","mcp","last_bk")
    tree=ttk.Treeview(frm,columns=cols,show="headings",height=8)
    for c,h in zip(cols,["Tenant","Users","MCP","Last Backup"]): tree.heading(c,text=h); tree.column(c,width=150)
    def do_login():
        st.set("Connecting...")
        def _():
            res=api.login(uv.get().strip(),pv.get())
            if res.get("success"): root.after(0,load)
            else: root.after(0,lambda:st.set(res.get("message","error")))
        threading.Thread(target=_,daemon=True).start()
    def load():
        st.set("Loading..."); tree.pack(fill="x",pady=10)
        def _():
            tenants=api.get_tenants(); stats=api.get_stats()
            for r in tree.get_children(): tree.delete(r)
            for t in tenants:
                tid=t["tenantId"]; s=stats.get(tid,{}); q=api.get_quota(tid)
                tree.insert("","end",values=(t.get("name") or tid,s.get("userCount",0),
                    str(q.get("used",0))+"/"+str(q.get("limit",1)),fmt(s.get("lastBackup"))))
            root.after(0,lambda:st.set("Loaded "+str(len(tenants))+" tenants"))
        threading.Thread(target=_,daemon=True).start()
    tk.Button(frm,text="Login",command=do_login,padx=16,pady=5).pack(pady=6)
    root.mainloop()

def _ctk():
    BG="#1a1a2e"; SURF="#16213e"; CARD="#0f3460"
    PRI="#6366f1"; SUC="#22c55e"; WARN="#f59e0b"; DAN="#ef4444"
    FG1="#f1f5f9"; FG2="#94a3b8"; FG3="#64748b"; BOR="#334155"
    ctk.set_appearance_mode("dark"); ctk.set_default_color_theme("blue")

    class LoginF(ctk.CTkFrame):
        def __init__(self,master,on_success):
            super().__init__(master,fg_color=BG)
            self.on_success=on_success
            self.grid_columnconfigure(0,weight=1); self.grid_rowconfigure((0,1,2),weight=1)
            card=ctk.CTkFrame(self,fg_color=SURF,corner_radius=16,border_width=1,border_color=BOR)
            card.grid(row=1,column=0,padx=80,sticky="ew"); card.grid_columnconfigure(0,weight=1)
            ctk.CTkLabel(card,text="Phopy",font=("",30,"bold"),text_color=PRI).grid(row=0,column=0,pady=(32,2))
            ctk.CTkLabel(card,text="Master Panel",font=("",13),text_color=FG2).grid(row=1,column=0,pady=(0,24))
            self.uv=ctk.StringVar(); self.pv=ctk.StringVar()
            ctk.CTkLabel(card,text="Username",text_color=FG2,anchor="w").grid(row=2,column=0,padx=32,sticky="w")
            ue=ctk.CTkEntry(card,textvariable=self.uv,height=38,fg_color=CARD,border_color=BOR)
            ue.grid(row=3,column=0,padx=32,sticky="ew",pady=(4,10)); ue.focus()
            ctk.CTkLabel(card,text="Password",text_color=FG2,anchor="w").grid(row=4,column=0,padx=32,sticky="w")
            ctk.CTkEntry(card,textvariable=self.pv,show="*",height=38,fg_color=CARD,border_color=BOR).grid(
                row=5,column=0,padx=32,sticky="ew",pady=(4,10))
            self.err=ctk.CTkLabel(card,text="",text_color=DAN); self.err.grid(row=6,column=0)
            self.btn=ctk.CTkButton(card,text="Login",height=42,fg_color=PRI,hover_color="#4f46e5",command=self._go)
            self.btn.grid(row=7,column=0,padx=32,pady=(8,32),sticky="ew")
        def _go(self):
            self.err.configure(text="Connecting..."); self.btn.configure(state="disabled")
            threading.Thread(target=self._do,daemon=True).start()
        def _do(self):
            try:
                res=api.login(self.uv.get().strip(),self.pv.get())
                if res.get("success"): self.after(0,self.on_success)
                else:
                    m=res.get("message","Error")
                    self.after(0,lambda:(self.err.configure(text=m),self.btn.configure(state="normal")))
            except Exception as ex:
                self.after(0,lambda:(self.err.configure(text=str(ex)),self.btn.configure(state="normal")))

    class DashF(ctk.CTkFrame):
        def __init__(self,master,on_logout):
            super().__init__(master,fg_color=BG)
            self.on_logout=on_logout
            self.grid_columnconfigure(0,weight=1); self.grid_rowconfigure(1,weight=1)
            top=ctk.CTkFrame(self,fg_color=SURF,height=52,corner_radius=0)
            top.grid(row=0,column=0,sticky="ew"); top.grid_propagate(False); top.grid_columnconfigure(1,weight=1)
            ctk.CTkLabel(top,text="Phopy Master Panel",font=("",17,"bold"),text_color=PRI).grid(
                row=0,column=0,padx=18,pady=12,sticky="w")
            self.st=ctk.CTkLabel(top,text="",font=("",11),text_color=FG3); self.st.grid(row=0,column=1)
            bf=ctk.CTkFrame(top,fg_color="transparent"); bf.grid(row=0,column=2,padx=14)
            ctk.CTkButton(bf,text="Refresh",width=88,height=30,fg_color=CARD,hover_color=BOR,
                command=self._refresh).pack(side="left",padx=3)
            ctk.CTkButton(bf,text="Logout",width=75,height=30,fg_color=DAN,hover_color="#dc2626",
                command=lambda:(setattr(api,"token",None),self.on_logout())).pack(side="left",padx=3)
            self.sc=ctk.CTkScrollableFrame(self,fg_color=BG)
            self.sc.grid(row=1,column=0,sticky="nsew"); self.sc.grid_columnconfigure(0,weight=1)
            bar=ctk.CTkFrame(self,fg_color=SURF,height=26,corner_radius=0)
            bar.grid(row=2,column=0,sticky="ew"); bar.grid_propagate(False)
            self.bl=ctk.CTkLabel(bar,text="",font=("",10),text_color=FG3); self.bl.pack(side="left",padx=12)
            self._refresh()
        def _refresh(self):
            self.st.configure(text="Loading...")
            threading.Thread(target=self._fetch,daemon=True).start()
        def _fetch(self):
            try:
                t=api.get_tenants(); s=api.get_stats()
                q={x["tenantId"]:api.get_quota(x["tenantId"]) for x in t}
                self.after(0,lambda:self._render(t,s,q))
            except Exception as ex: self.after(0,lambda:self.st.configure(text="Err:"+str(ex)))
        def _render(self,tenants,stats,quotas):
            for w in self.sc.winfo_children(): w.destroy()
            now=datetime.now().strftime("%H:%M:%S")
            tu=sum(stats.get(t["tenantId"],{}).get("userCount",0) for t in tenants)
            mu=sum(q.get("used",0) for q in quotas.values())
            ml=sum(q.get("limit",1) for q in quotas.values())
            self.st.configure(text="Updated "+now)
            self.bl.configure(text="Tenants:"+str(len(tenants))+"  Users:"+str(tu)+"  MCP:"+str(mu)+"/"+str(ml))
            for i,t in enumerate(tenants):
                self._card(i,t,stats.get(t["tenantId"],{}),quotas.get(t["tenantId"],{"used":0,"limit":1}))
        def _card(self,row,t,s,q):
            tid=t["tenantId"]; active=t.get("isCurrentTenant",False)
            c=ctk.CTkFrame(self.sc,fg_color=CARD,corner_radius=12,border_width=1,border_color=BOR)
            c.grid(row=row,column=0,sticky="ew",padx=14,pady=7); c.grid_columnconfigure(0,weight=1)
            nm=(t.get("name") or tid)+(" [ACTIVE]" if active else "")
            ctk.CTkLabel(c,text=nm,font=("",14,"bold"),text_color=FG1).grid(row=0,column=0,sticky="w",padx=14,pady=(12,2))
            ctk.CTkLabel(c,text=tid,font=("",9),text_color=FG3).grid(row=1,column=0,sticky="w",padx=14)
            ctk.CTkFrame(c,height=1,fg_color=BOR).grid(row=2,column=0,sticky="ew",padx=14,pady=6)
            sf=ctk.CTkFrame(c,fg_color="transparent"); sf.grid(row=3,column=0,sticky="ew",padx=14)
            sf.grid_columnconfigure((0,1,2),weight=1)
            for col,(val,lab) in enumerate([
                (str(s.get("userCount",0)),"Users"),
                (str(s.get("backupCount",0)),"Backups"),
                (fmt(s.get("lastBackup")),"Last Backup")]):
                f2=ctk.CTkFrame(sf,fg_color=BG,corner_radius=8); f2.grid(row=0,column=col,padx=3,pady=3,sticky="ew")
                ctk.CTkLabel(f2,text=val,font=("",11,"bold"),text_color=FG1).pack(pady=(7,1))
                ctk.CTkLabel(f2,text=lab,font=("",9),text_color=FG3).pack(pady=(0,7))
            used=q.get("used",0); limit=q.get("limit",1); ratio=min(used/max(limit,1),1.0)
            bc=DAN if ratio>=1 else WARN if ratio>=0.8 else SUC
            mf=ctk.CTkFrame(c,fg_color="transparent"); mf.grid(row=4,column=0,sticky="ew",padx=14,pady=(8,0))
            mf.grid_columnconfigure(1,weight=1)
            ctk.CTkLabel(mf,text="MCP "+str(used)+"/"+str(limit),font=("",11),text_color=PRI).grid(row=0,column=0,sticky="w")
            pb=ctk.CTkProgressBar(mf,height=6,fg_color=BG,progress_color=bc)
            pb.set(ratio); pb.grid(row=0,column=1,padx=(8,4),sticky="ew")
            ctk.CTkButton(mf,text="Set",width=36,height=22,fg_color=SURF,hover_color=BOR,
                command=lambda _t=tid,_l=limit:self._eq(_t,_l)).grid(row=0,column=2)
            bf2=ctk.CTkFrame(c,fg_color="transparent"); bf2.grid(row=5,column=0,sticky="ew",padx=14,pady=(8,12))
            bf2.grid_columnconfigure((0,1),weight=1)
            ctk.CTkButton(bf2,text="Switch",height=34,fg_color=PRI,hover_color="#4f46e5",
                state="disabled" if active else "normal",
                command=lambda _t=tid:self._sw(_t)).grid(row=0,column=0,padx=(0,3),sticky="ew")
            ctk.CTkButton(bf2,text="Backup",height=34,fg_color=SURF,hover_color=BOR,
                border_width=1,border_color=BOR,
                command=lambda _t=tid:self._bk(_t)).grid(row=0,column=1,padx=(3,0),sticky="ew")
        def _sw(self,tid):
            self.st.configure(text="Switching...")
            def do():
                res=api.switch_tenant(tid)
                if res.get("success"): api.token=res["data"]["token"]; self.after(0,self._refresh)
                else: self.after(0,lambda:self.st.configure(text="Switch failed"))
            threading.Thread(target=do,daemon=True).start()
        def _bk(self,tid):
            self.st.configure(text="Backup...")
            def do():
                res=api.trigger_backup(tid)
                msg="OK" if res.get("success") else "Failed"
                self.after(0,lambda:self.st.configure(text="Backup "+msg))
                self.after(3000,lambda:self.st.configure(text=""))
            threading.Thread(target=do,daemon=True).start()
        def _eq(self,tid,cur):
            d=ctk.CTkInputDialog(text="MCP limit for "+tid+" (now:"+str(cur)+")",title="Quota")
            v=d.get_input()
            if not v: return
            try: n=int(v)
            except: return
            threading.Thread(target=lambda:(api.set_quota(tid,n),self.after(0,self._refresh)),daemon=True).start()

    class App(ctk.CTk):
        def __init__(self):
            super().__init__()
            self.title("Phopy Master Panel"); self.geometry("960x660"); self.minsize(860,560)
            self.grid_columnconfigure(0,weight=1); self.grid_rowconfigure(0,weight=1); self._login()
        def _clear(self):
            for w in self.winfo_children(): w.destroy()
        def _login(self):
            self._clear(); LoginF(self,on_success=self._dash).grid(row=0,column=0,sticky="nsew")
        def _dash(self):
            self._clear(); DashF(self,on_logout=self._login).grid(row=0,column=0,sticky="nsew")
    App().mainloop()

if __name__ == "__main__": main()