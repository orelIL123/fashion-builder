import struct,sys
MAP,LIST=22,20
def node(d,o):
    n=d[o]; o+=1
    lens=d[o:o+n]; o+=n
    types=d[o:o+n]; o+=n
    sizes=struct.unpack_from('<%dI'%n,d,o); o+=4*n
    out=[]
    for L,t,s in zip(lens,types,sizes):
        name=d[o:o+L].decode('latin1'); o+=L
        out.append((name,t,o,s)); o+=s
    return out
def lst(d,o):
    c=struct.unpack_from('<I',d,o)[0]; o+=4
    if c==0: return 0,[]
    t=d[o]; o+=1
    sizes=struct.unpack_from('<%dI'%c,d,o); o+=4*c
    els=[]
    for s in sizes: els.append((o,s)); o+=s
    return t,els
def prim(d,t,o,s):
    b=d[o:o+s]
    if t==15:
        try: return b.decode('utf-8')
        except: return b
    if s==4 and t in(5,): return struct.unpack('<I',b)[0]
    if s==4: return (struct.unpack('<i',b)[0],struct.unpack('<f',b)[0])
    if s==1: return b[0]
    if s<=64 and s%4==0: return ('f',struct.unpack('<%df'%(s//4),b))
    return ('t%d'%t,s,b[:24].hex())
def dump(d,o,s,ind=0,maxd=99,maxel=2,path=''):
    for name,t,vo,vs in node(d,o):
        p=path+'/'+name
        if t==MAP:
            print('  '*ind+f'{name} MAP {vs}')
            if ind<maxd: dump(d,vo,vs,ind+1,maxd,maxel,p)
        elif t==LIST:
            et,els=lst(d,vo)
            print('  '*ind+f'{name} LIST n={len(els)} et={et} {vs}')
            if et==MAP and ind<maxd:
                for i,(eo,es) in enumerate(els[:maxel]):
                    print('  '*ind+f' [{i}] {es}')
                    dump(d,eo,es,ind+2,maxd,maxel,p)
            elif els:
                print('  '*ind+'   elems:',[prim(d,et,eo,es) for eo,es in els[:6]])
        else:
            print('  '*ind+f'{name} t{t} = {prim(d,t,vo,vs)}')
if __name__=='__main__':
    d=open(sys.argv[1],'rb').read()
    dump(d,0,len(d),maxd=int(sys.argv[2]) if len(sys.argv)>2 else 99, maxel=int(sys.argv[3]) if len(sys.argv)>3 else 2)
