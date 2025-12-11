import { FigmaCodeWorkflowState } from "../types/workflow-types";


export const planningPrompt = ``;

export const analyzePlanningPrompt = (state: FigmaCodeWorkflowState) => {
  let selectedNodesInfo = "";
 
  return planningPrompt + selectedNodesInfo;
};
