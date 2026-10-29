"""Genera la página interactiva del gráfico de memoria/ (como la vista de gráfico de Obsidian).

Uso: python3 dev/grafo-memoria.py <salida.html>
"""
import json, os, re, sys

RAIZ = os.path.join(os.path.dirname(__file__), "..", "memoria")
notas = []
for carpeta in ("decisiones", "errores", "entorno", "pendientes"):
    for f in sorted(os.listdir(os.path.join(RAIZ, carpeta))):
        if not f.endswith(".md"):
            continue
        txt = open(os.path.join(RAIZ, carpeta, f), encoding="utf-8").read()
        fm, cuerpo = re.match(r"---\n(.*?)\n---\n(.*)", txt, re.S).groups()
        meta = dict(l.split(": ", 1) for l in fm.splitlines())
        cuerpo = re.sub(r"^# .*\n+", "", cuerpo)
        notas.append({
            "id": f[:-3], "titulo": f[:-3].replace("-", " "), "tipo": meta["tipo"],
            "fecha": meta.get("fecha", ""), "commit": meta.get("commit", ""), "texto": cuerpo.strip(),
        })
ids = {n["id"] for n in notas}
enlaces = sorted({tuple(sorted((n["id"], d))) for n in notas
                  for d in re.findall(r"\[\[([^\]]+)\]\]", n["texto"]) if d in ids and d != n["id"]})
plantilla = open(os.path.join(os.path.dirname(__file__), "grafo-memoria.html"), encoding="utf-8").read()
datos = json.dumps({"notas": notas, "enlaces": enlaces}, ensure_ascii=False).replace("</", "<\\/")
open(sys.argv[1], "w", encoding="utf-8").write(plantilla.replace("/*DATOS*/null", datos))
print(f"{len(notas)} notas · {len(enlaces)} conexiones → {sys.argv[1]}")
