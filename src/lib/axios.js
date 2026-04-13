import axios from "axios";

const axiosInstance = axios.create({
    baseURl: import.meta.env.VITE_API_URL, 
    withCredentials: true //by adding thid field browser will send cookies automatically with every single reqest            
})

export default axiosInstance;