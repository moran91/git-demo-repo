import json,urllib.request,os
B='https://1moment.co.il/api/v1'
def get(url,mod):
    r=urllib.request.Request(B+url,headers={'zoneId':'[2]','moduleId':str(mod),'User-Agent':'Mozilla/5.0'})
    return json.load(urllib.request.urlopen(r,timeout=60))
out={}
for mod in (2,3):
    for s in get('/stores/get-stores/all?offset=1&limit=200',mod)['stores']:
        det=get(f"/stores/details/{s['id']}",mod)
        items=get(f"/items/latest?store_id={s['id']}&category_id=0&offset=1&limit=1000",mod)
        out[s['id']]={'store':det,'items':items.get('products',[]),'categories':items.get('categories',[])}
        print(s['id'],s['name'],len(out[s['id']]['items']),flush=True)
json.dump(out,open('stores.json','w'),ensure_ascii=False)
