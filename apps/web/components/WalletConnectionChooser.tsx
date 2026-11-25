'use client';
import {useEffect,useRef,useState} from 'react';
import './wallet-connection.css';

export default function WalletConnectionChooser({open,onClose,onExtension}:{open:boolean;onClose:()=>void;onExtension:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [mobile,setMobile]=useState(false);
 useEffect(()=>{
  if(open){setMobile(false);if(!dialog.current?.open)dialog.current?.showModal();}
  else dialog.current?.close();
 },[open]);
 return <dialog ref={dialog} className="wallet-connection" aria-labelledby="wallet-connection-title" onCancel={onClose} onClose={onClose}>
  <div className="wallet-connection-heading"><h2 id="wallet-connection-title">Connect QoreX</h2><button type="button" className="secondary" onClick={onClose} aria-label="Close wallet chooser">×</button></div>
  {mobile?<>
   <h3>QoreX mobile</h3>
   <p role="status">Mobile QR pairing is not available in Canary yet. No wallet connection has been requested.</p>
   <p>QoreChain’s Dashboard uses its own mobile pairing flow. Canary still needs a verified connection that can send contract requests to your phone for approval.</p>
   <button type="button" className="secondary" onClick={()=>setMobile(false)}>Back to connection options</button>
  </>:<>
   <p>Choose where you want to approve wallet requests.</p>
   <button type="button" className="wallet-connection-option" onClick={()=>setMobile(true)}><strong>Mobile wallet</strong><span>Scan to connect · Not available yet</span></button>
   <button type="button" className="wallet-connection-option" onClick={onExtension}><strong>Browser extension</strong><span>Connect the QoreX extension on this computer</span></button>
   <p className="helper">Canary transactions require Diana testnet. Connecting your public account does not send a transaction.</p>
  </>}
 </dialog>;
}
