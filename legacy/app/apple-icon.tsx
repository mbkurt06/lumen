import { ImageResponse } from "next/og";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";
export default function AppleIcon() {
  return new ImageResponse(
    <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",background:"#315b4d",borderRadius:36}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",width:130,height:120,color:"#f7f1df",fontSize:92,fontWeight:700}}>ل</div>
    </div>,
    {...size}
  );
}
